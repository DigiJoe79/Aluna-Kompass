import { invalid, isoNow, newId, notFound, ok, readLocales, readSetting, recordAudit, requireHumanChannel, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { applyDispatchInternal, canReadDocumentType, dmsMailOutbox, documents, mailNotReady, movePairToPostInternal, previewSend, queueDocumentEmailsInternal, readLinkedDocument, returnPairToEmailInternal, type MailOutboxStatus, type SendPlanItem, type SendPlanReason } from '@kompass/module-dms';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { membersConflict } from './errors';
import { memberDunningNotices, memberDunningRuns, memberFeeRuns, memberMemberships, memberRunLetters } from './schema';
import type { DunningLevel } from './settings';

const HUMAN_ONLY_SETTING = 'members.mcpHumanOnlyAllowed';

/** Die Läufe mit Schritt „Versand“ (Handoff 2.5, 2b E3): Beitragslauf und Mahnlauf. */
export const RUN_REF = /^members(Fee|Dunning)Run:[0-9A-Za-z]+$/;
export type RunKind = 'feeRun' | 'dunningRun';
const kindOf = (runRef: string): RunKind => (runRef.startsWith('membersFeeRun:') ? 'feeRun' : 'dunningRun');
const PDF_NAME: Record<RunKind, string> = { feeRun: 'Briefe-Beitragslauf.pdf', dunningRun: 'Briefe-Mahnlauf.pdf' };

export const runRefSchema = z.object({ runRef: z.string().regex(RUN_REF) });
/** `documentIds`: nur diese Briefe der Post-Gruppe (je Zeile „Versand vermerken …“, Handoff 2b E3); ohne: alle offenen. */
export const runMarkPostSchema = runRefSchema.extend({ sentAt: z.iso.date(), documentIds: z.array(z.string().min(1)).min(1).max(500).optional() });

/** „Per Post schicken“ bzw. „Zurück zu E-Mail“ je Zeile (Plan U4 Task 2): `post` aus der Mail-Gruppe, `email` zurück. */
export const runMoveSchema = runRefSchema.extend({ documentIds: z.array(z.string().min(1)).min(1).max(500), to: z.enum(['post', 'email']) });

/** Zustand einer Mail-Zeile: noch nicht eingereiht oder der Zustand im Ausgang. */
export type OutboxState = MailOutboxStatus | 'notQueued';

/** Was jede Zeile zeigt (Handoff 2b E3): Name, Brief, Stufe — ohne Adresse im Protokoll, nur in der Anzeige. */
interface RunLetterInfo {
  documentId: string;
  documentNumber: string | null;
  membershipId: string;
  memberNumber: string;
  name: string;
  /** Mahnstufe des Briefs (Mahnlauf); `null` bei der Beitragsmitteilung. */
  levelName: string | null;
  /** Versandvermerk am Dokument (Tag), gesetzt von Hand oder vom Sender. */
  sentAt: string | null;
}

export interface RunDispatchState {
  mail: (RunLetterInfo & { state: OutboxState; address: string; outboxId: string | null; errorCode: string | null; errorText: string | null })[];
  post: (RunLetterInfo & { reason: SendPlanReason; dispatched: boolean })[];
  /**
   * Jede Zeile gesendet oder per Post vermerkt (2b E3); ein „nicht zugestellt“ ist kein Vermerk. Nie, solange der Lauf
   * noch Briefe ausstellt (U11, Plan N3).
   */
  done: boolean;
  /** F7: Briefe des Laufs, die inzwischen storniert sind — sie gehen nicht hinaus und zählen nicht für „fertig“. */
  voided: RunLetterInfo[];
  /**
   * Briefe des Laufs, die der Aufrufer nicht lesen darf (Backlog 78): die Ankündigung an einen fremden Kontoinhaber ohne
   * Finanzrechte. Nur gezählt, ohne Namen — sie versendet, wer die Rechte hat; für „fertig“ zählen sie hier nicht.
   */
  restricted: number;
  /** Zustand des Mailversands (Testumgebung mit Umleitung, gesperrt, aus) — für den Hinweis über den Gruppen. */
  mailState: { kind: 'off' | 'ready' | 'redirect' | 'blocked'; redirectTo: string | null };
}

/** Hält in der Transaktion des Ausstellens fest, dass ein Brief zu einem Lauf gehört. */
export function recordRunLetterInternal(tx: DbOrTx, deps: Deps, input: { runRef: string; membershipId: string; documentId: string; contactId: string }): void {
  tx.insert(memberRunLetters).values({ id: newId(), ...input, createdAt: isoNow(deps.clock) }).run();
}

/** Die Briefe eines Laufs in der Reihenfolge der Mitgliedsnummern, ohne stornierte Dokumente. */
function runLetters(db: DbOrTx, runRef: string) {
  return allRunLetters(db, runRef).filter((r) => r.status !== 'voided');
}

/** Alle Briefe eines Laufs, auch stornierte (F7: der Lauf zeigt sie als storniert). */
function allRunLetters(db: DbOrTx, runRef: string) {
  return db
    .select({ documentId: memberRunLetters.documentId, membershipId: memberRunLetters.membershipId, contactId: memberRunLetters.contactId, memberNumber: memberMemberships.memberNumber, number: documents.number, sentAt: documents.sentAt, status: documents.status, typeKey: documents.typeKey })
    .from(memberRunLetters)
    .innerJoin(memberMemberships, eq(memberMemberships.id, memberRunLetters.membershipId))
    .innerJoin(documents, eq(documents.id, memberRunLetters.documentId))
    .where(eq(memberRunLetters.runRef, runRef))
    .orderBy(asc(memberMemberships.memberNumber), asc(memberRunLetters.createdAt))
    .all();
}

/** Stellt der Lauf noch Briefe aus (`running`)? Dann ist sein Versand nicht fertig, auch wenn noch keine Zeile da ist. */
function runStillRunning(db: DbOrTx, runRef: string): boolean {
  const id = runRef.slice(runRef.indexOf(':') + 1);
  const table = kindOf(runRef) === 'feeRun' ? memberFeeRuns : memberDunningRuns;
  return db.select({ status: table.status }).from(table).where(eq(table.id, id)).get()?.status === 'running';
}

/** Der Weg je Brief aus der Vorschau der Akte (E1), in Häppchen zu 500. */
async function planOf(deps: Deps, ctx: CallContext, documentIds: string[]): Promise<Result<SendPlanItem[]>> {
  const items: SendPlanItem[] = [];
  for (let i = 0; i < documentIds.length; i += 500) {
    const preview = await previewSend(deps, ctx, { documentIds: documentIds.slice(i, i + 500) });
    if (!preview.ok) return preview;
    items.push(...preview.value.items);
  }
  return ok(items);
}

async function stateOf(deps: Deps, ctx: CallContext, runRef: string): Promise<Result<Omit<RunDispatchState, 'mailState'> & { plan: SendPlanItem[]; letters: ReturnType<typeof runLetters> }>> {
  // Backlog 78: Was der Aufrufer nicht lesen darf, kommt nicht in den Plan — sonst scheiterte der ganze Plan daran.
  const readable = new Map<string, boolean>();
  const mayRead = (typeKey: string) => readable.get(typeKey) ?? readable.set(typeKey, canReadDocumentType(deps, ctx, typeKey)).get(typeKey)!;
  const every = allRunLetters(deps.db, runRef);
  const all = every.filter((r) => mayRead(r.typeKey));
  const restricted = every.filter((r) => r.status !== 'voided').length - all.filter((r) => r.status !== 'voided').length;
  const letters = all.filter((r) => r.status !== 'voided');
  const plan = letters.length === 0 ? ok([] as SendPlanItem[]) : await planOf(deps, ctx, letters.map((l) => l.documentId));
  if (!plan.ok) return plan;
  const byDoc = new Map(all.map((l) => [l.documentId, l]));
  const contactIds = [...new Set(all.map((l) => l.contactId))];
  const names = new Map(contactIds.length ? deps.db.select().from(contacts).where(inArray(contacts.id, contactIds)).all().map((c) => [c.id, displayName(c)]) : []);
  const levels = readSetting<DunningLevel[]>(deps, 'members.dunningLevels');
  const leading = readLocales(deps)[0]!;
  const levelOf = new Map(
    all.length
      ? deps.db.select({ documentId: memberDunningNotices.documentId, levelKey: memberDunningNotices.levelKey }).from(memberDunningNotices).where(inArray(memberDunningNotices.documentId, all.map((l) => l.documentId))).all().map((n) => {
          const level = levels.find((l) => l.key === n.levelKey);
          return [n.documentId, level ? level.name[leading] || Object.values(level.name).find((v) => v) || level.key : n.levelKey] as const;
        })
      : [],
  );
  const info = (documentId: string): RunLetterInfo => {
    const letter = byDoc.get(documentId)!;
    return { documentId, documentNumber: letter.number, membershipId: letter.membershipId, memberNumber: letter.memberNumber ?? '', name: names.get(letter.contactId) ?? '', levelName: levelOf.get(documentId) ?? null, sentAt: letter.sentAt };
  };
  const mail: RunDispatchState['mail'] = [];
  const post: RunDispatchState['post'] = [];
  for (const item of plan.value) {
    const letter = byDoc.get(item.documentId)!;
    if (item.channel === 'email') {
      const entry = deps.db.select().from(dmsMailOutbox).where(and(eq(dmsMailOutbox.documentId, item.documentId), eq(dmsMailOutbox.contactId, item.contactId))).orderBy(desc(dmsMailOutbox.queuedAt), desc(dmsMailOutbox.id)).get();
      mail.push({ ...info(item.documentId), state: item.outboxStatus ?? 'notQueued', address: item.address, outboxId: entry?.id ?? null, errorCode: entry?.lastErrorCode ?? null, errorText: entry?.lastErrorText ?? null });
    } else post.push({ ...info(item.documentId), reason: item.reason, dispatched: letter.sentAt !== null });
  }
  const sentAt = (documentId: string) => byDoc.get(documentId)?.sentAt ?? null;
  const done = !runStillRunning(deps.db, runRef) && mail.every((m) => m.state === 'sent' || sentAt(m.documentId) !== null) && post.every((p) => p.dispatched);
  const voided = all.filter((l) => l.status === 'voided').map((l) => info(l.documentId));
  return ok({ mail, post, done, voided, restricted, plan: plan.value, letters });
}

/** Der Schritt „Versand“ eines Laufs: Mail-Gruppe mit Zustand, Post-Gruppe mit Grund und Vermerk. `members.read`. */
export async function runDispatchState(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<RunDispatchState>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, runRefSchema, input);
  if (!parsed.ok) return parsed;
  const state = await stateOf(deps, ctx, parsed.value.runRef);
  if (!state.ok) return state;
  const { mail, post, done, voided, restricted } = state.value;
  const mailState = deps.mail.state();
  return ok({ mail, post, done, voided, restricted, mailState: { kind: mailState.kind, redirectTo: mailState.kind === 'redirect' ? mailState.to : null } });
}

/**
 * „{n} per E-Mail senden“ (nur ein Mensch; `members.fees` und `dms.send`): reiht die Mail-Gruppe mit dem Lauf als
 * `runRef` ein. Schon eingereihte oder gesendete Briefe bleiben, wie sie sind. Der Versandvermerk entsteht beim Senden.
 */
export async function sendRunMails(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ queued: number; post: number }>> {
  const denied = requirePermission(ctx, 'members.fees') ?? requirePermission(ctx, 'dms.send');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, runRefSchema, input);
  if (!parsed.ok) return parsed;
  const { runRef } = parsed.value;
  const notReady = mailNotReady(deps);
  if (notReady) return notReady;
  const state = await stateOf(deps, ctx, runRef);
  if (!state.ok) return state;
  // R9: Ein Brief mit Versandvermerk (etwa schon per Post) geht nicht noch einmal per Mail.
  const sentAt = new Map(state.value.letters.map((l) => [l.documentId, l.sentAt]));
  const items = state.value.plan.flatMap((p) => (p.channel === 'email' && !p.outboxStatus && !sentAt.get(p.documentId) ? [{ documentId: p.documentId, contactId: p.contactId }] : []));
  return deps.db.transaction((tx: DbOrTx) => {
    const { queued, skipped } = queueDocumentEmailsInternal(tx, deps, ctx, { items, runRef });
    recordAudit(tx, deps, ctx, { action: 'members.run.mail', entityType: 'memberRun', entityId: runRef, after: { queued: queued.length }, params: { kind: kindOf(runRef), count: queued.length } });
    return ok({ queued: queued.length, post: state.value.post.length + skipped.length });
  });
}

/** „Als PDF zum Drucken“: die Post-Gruppe als ein PDF, Reihenfolge der Mitgliedsnummern. Nur lesen. `members.read`. */
export async function runPrintPdf(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ fileName: string; bytes: Uint8Array; count: number }>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, runRefSchema, input);
  if (!parsed.ok) return parsed;
  const { runRef } = parsed.value;
  const state = await stateOf(deps, ctx, runRef);
  if (!state.ok) return state;
  const letters = new Map(state.value.letters.map((l) => [l.documentId, l]));
  if (state.value.post.length === 0) return membersConflict('runNothingToPrint');
  const files: Uint8Array[] = [];
  for (const row of state.value.post) {
    const copy = await readLinkedDocument(deps, ctx, { documentId: row.documentId, entityType: 'membership', entityId: letters.get(row.documentId)!.membershipId });
    if (!copy.ok) return copy;
    files.push(copy.value.bytes);
  }
  const bytes = files.length === 1 ? files[0]! : await deps.pdf.merge(files);
  return ok({ fileName: PDF_NAME[kindOf(runRef)], bytes, count: files.length });
}

/**
 * „Versand vermerken“ für die Post-Gruppe: Weg `post` an jedem noch nicht vermerkten Brief. `members.fees`. Mit
 * `documentIds` auch Briefe der Mail-Gruppe, die nicht eingereiht sind (M42): Wer die Mail nicht senden kann oder will,
 * druckt den Brief. Ein eingereihter Brief geht per Mail (`runLetterQueued`) — erst „Per Post schicken“ in der Akte.
 */
export async function markRunPostDispatched(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ count: number }>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const parsed = validate(deps, runMarkPostSchema, input);
  if (!parsed.ok) return parsed;
  const { runRef, sentAt, documentIds } = parsed.value;
  if (sentAt > todayIn(deps)) return invalid([{ path: 'sentAt', message: 'sentInFuture' }]);
  const state = await stateOf(deps, ctx, runRef);
  if (!state.ok) return state;
  // U6 (Plan N3): Ein genannter stornierter Brief geht nicht hinaus — der Satz nennt das, nicht einen Vermerk.
  if (documentIds && state.value.voided.some((v) => documentIds.includes(v.documentId))) return membersConflict('runLetterVoided');
  const asked = (id: string) => !documentIds || documentIds.includes(id);
  const mailAsked = documentIds ? state.value.mail.filter((m) => documentIds.includes(m.documentId) && m.state !== 'sent' && m.sentAt === null) : [];
  if (mailAsked.some((m) => m.state === 'queued' || m.state === 'sending')) return membersConflict('runLetterQueued');
  const open = [...state.value.post.filter((p) => !p.dispatched && asked(p.documentId)).map((p) => p.documentId), ...mailAsked.map((m) => m.documentId)];
  // R13 (M42): Ohne Auswahl und mit leerer Post-Gruppe nennt der Satz den Weg über die einzelnen Briefe der Mail-Gruppe.
  if (open.length === 0 && !documentIds && state.value.mail.some((m) => m.state !== 'sent' && m.sentAt === null)) return membersConflict('runPostGroupEmpty');
  // V2 (Retest N3): Ohne Auswahl und ohne offene Briefe, aber mit Stornos nennt der Satz die Stornos.
  if (open.length === 0 && !documentIds && state.value.voided.length > 0) return membersConflict('runRestVoided');
  if (open.length === 0) return membersConflict('runNothingToDispatch');
  return deps.db.transaction((tx: DbOrTx) => {
    const rows = tx.select().from(documents).where(inArray(documents.id, open)).all();
    const early = rows.find((r) => sentAt < r.documentDate);
    if (early) return invalid([{ path: 'sentAt', message: 'sentBeforeDocumentDate' }]);
    for (const row of rows) applyDispatchInternal(tx, deps, ctx, row, { sentAt, sentVia: 'post', note: null });
    recordAudit(tx, deps, ctx, { action: 'members.run.markPost', entityType: 'memberRun', entityId: runRef, after: { count: rows.length, sentAt }, params: { kind: kindOf(runRef), count: rows.length, sentOn: sentAt } });
    return ok({ count: rows.length });
  });
}

/** Bricht die Transaktion des Verschiebens mit dem Grund der Akte ab — alle oder keine. */
class MoveAborted extends Error {
  constructor(readonly failure: Failure) {
    super('run move aborted');
  }
}

/**
 * „Per Post schicken“ / „Zurück zu E-Mail“ je Zeile (Nachtrag MCP-Test § 2, Plan U4 Task 2) — `members.fees`, wie der
 * Vermerk. `post`: Briefe der Mail-Gruppe, die warten oder nicht zugestellt sind, wandern mit Grund `manual` in die
 * Post-Gruppe (eine eingereihte Mail wird zurückgezogen); unterwegs oder gesendet lehnt die Akte ab
 * (`mailNotPending`). `email`: nur von Hand verschobene Briefe ohne Versandvermerk. Alle oder keiner; Protokoll
 * `members.run.toPost`/`members.run.toEmail` mit der Zahl, je Brief dazu der Eintrag der Akte.
 */
export async function moveRunLetters(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ count: number }>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const parsed = validate(deps, runMoveSchema, input);
  if (!parsed.ok) return parsed;
  const { runRef, documentIds, to } = parsed.value;
  const letters = new Map(runLetters(deps.db, runRef).map((l) => [l.documentId, l]));
  const missing = documentIds.find((id) => !letters.has(id));
  if (missing) return notFound('document', missing);
  try {
    return deps.db.transaction((tx: DbOrTx) => {
      for (const documentId of documentIds) {
        const pair = { documentId, contactId: letters.get(documentId)!.contactId, runRef };
        const moved = to === 'post' ? movePairToPostInternal(tx, deps, ctx, pair) : returnPairToEmailInternal(tx, deps, ctx, pair);
        if (!moved.ok) throw new MoveAborted(moved);
      }
      const entry = { entityType: 'memberRun', entityId: runRef, after: { count: documentIds.length }, params: { kind: kindOf(runRef), count: documentIds.length } };
      if (to === 'post') recordAudit(tx, deps, ctx, { action: 'members.run.toPost', ...entry });
      else recordAudit(tx, deps, ctx, { action: 'members.run.toEmail', ...entry });
      return ok({ count: documentIds.length });
    });
  } catch (error) {
    if (error instanceof MoveAborted) return error.failure;
    throw error;
  }
}
