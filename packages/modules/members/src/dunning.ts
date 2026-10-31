import { invalid, isoNow, newId, notFound, ok, readLocales, readSetting, recordAudit, requireHumanChannel, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { abortIssue, documents, documentSnippets } from '@kompass/module-dms';
import {
  activeRunItemsInternal,
  draftSettlementCentsInternal,
  expiredRunIdsInternal,
  financeContactBankAccounts,
  financeOpenItems,
  mandateRowInternal,
  mandateState,
  normalizeIban,
  openCentsInternal,
  openItemReturnStateInternal,
  openRawTransactionsInternal,
  returnsByItemInternal,
  unreturnedRunItemsInternal,
  type FinanceOpenItemRow,
  type FinanceRawTransactionRow,
} from '@kompass/module-finance';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { membersConflict } from './errors';
import { agreementAt } from './fee-agreement';
import { mandateForChargeInternal } from './payment-method';
import { issueMemberLetterInternal } from './letters/issue';
import { addDays } from './letters/shared';
import { dispatchMap, reachedLevel } from './dunning-levels';
import { mergeRefused, recordRunLetterInternal } from './run-dispatch';
import { runListSchema } from './fee-run';

export { dunningLevelsOfCharges, reachedLevel } from './dunning-levels';
import { memberDunningNotices, memberDunningRuns, memberFeeCharges, memberMemberships, type DunningNoticeRow, type DunningRunRow, type FeeChargeRow, type MembershipRow } from './schema';
import type { DunningLevel } from './settings';

const HUMAN_ONLY_SETTING = 'members.mcpHumanOnlyAllowed';
/** Wie weit zurück ein noch nicht zugeordneter Eingang „passen könnte“ (Review Focus 1). */
const MATCH_WINDOW_DAYS = 30;

export const DUNNING_SKIP_REASONS = ['lastLevelReached', 'previousNotSent', 'directDebit', 'deferred', 'paymentDraft'] as const;
export type DunningSkipReason = (typeof DUNNING_SKIP_REASONS)[number];

export const dunningPreviewSchema = z.object({ asOf: z.iso.date() });
export const dunningStartSchema = dunningPreviewSchema;
export const dunningContinueSchema = z.object({ runId: z.string().min(1), max: z.number().int().min(1).max(50).default(10) });

export interface DunningCandidate {
  membershipId: string;
  memberNumber: string;
  name: string;
  levelKey: string;
  levelName: string;
  chargeIds: string[];
  sumCents: number;
  /** Tag des zurückgegebenen Einzugs, wenn einer der Posten aus einer Rückgabe stammt. */
  returnedOn: string | null;
}
export interface DunningPreview {
  asOf: string;
  ready: DunningCandidate[];
  /** Ein nicht zugeordneter Eingang könnte die Zahlung sein: Diese Mahnung hält an, nicht der Lauf (Handoff 2.5). */
  paymentMayMatch: (DunningCandidate & { rawTransactionIds: string[] })[];
  skipped: { membershipId: string; memberNumber: string; name: string; reason: DunningSkipReason }[];
}
export type DunningRunView = DunningRunRow & { issued: number };
/** Ein Lauf mit den Briefen, die zum Stichtag noch ausstehen (für den Fortschritt). */
export type DunningRunDetail = DunningRunView & { remaining: number };

const levelName = (deps: Deps, level: DunningLevel): string => level.name[readLocales(deps)[0]!] || Object.values(level.name).find((v) => v) || level.key;

interface OpenCharge {
  charge: FeeChargeRow;
  item: FinanceOpenItemRow;
  dueOn: string;
  openCents: number;
  /** Warum nicht gemahnt wird, obwohl offen; sonst `null`. */
  hold: 'directDebit' | 'inRun' | 'draftPayment' | null;
  returnedOn: string | null;
}

/** Die offenen Beiträge einer Mitgliedschaft mit dem, was eine Mahnung für sie ausschließt (Spec § 4.5). */
function openChargesOf(db: DbOrTx, deps: Deps, membershipId: string, asOf: string): OpenCharge[] {
  const rows = db
    .select({ charge: memberFeeCharges, item: financeOpenItems })
    .from(memberFeeCharges)
    .innerJoin(financeOpenItems, eq(financeOpenItems.id, memberFeeCharges.openItemId))
    .where(and(eq(memberFeeCharges.membershipId, membershipId), eq(memberFeeCharges.state, 'created'), isNotNull(memberFeeCharges.openItemId)))
    .all()
    .filter((r) => r.item.cancelledAt === null);
  const out: OpenCharge[] = [];
  // Plan N1 (M41): Ein verfallener Einzug hält seine Posten nicht mehr — sie werden gemahnt wie ohne Einzug.
  const expired = expiredRunIdsInternal(deps, db);
  for (const { charge, item } of rows) {
    const openCents = openCentsInternal(db, item.id);
    if (openCents <= 0) continue;
    const dueOn = item.dueOn ?? charge.dueOn;
    let hold: OpenCharge['hold'] = null;
    let returnedOn: string | null = null;
    const back = openItemReturnStateInternal(db, item.id);
    if (back === 'open' || back === 'transfer') {
      const items = activeRunItemsInternal(db, { source: 'openItem', sourceId: item.id });
      const returns = returnsByItemInternal(db, items.map((r) => r.item.id));
      returnedOn = items.filter((r) => returns.has(r.item.id)).map((r) => r.collectionDate).sort().at(-1) ?? null;
    } else if (back === 'recollect') hold = 'directDebit';
    else if (unreturnedRunItemsInternal(db, { source: 'openItem', sourceId: item.id, excludeRunIds: expired }).length > 0) hold = 'inRun';
    else {
      // Lastschrift-Zahler: erst gemahnt, wenn ein Einzug zurückkam oder das Mandat nicht aktiv ist (Review Focus 5). Ein
      // nur vorbereitetes Mandat ist kein Zahlweg — mit ihm wird nie eingezogen; gemahnt wird wie bei Überweisung.
      // Der Zahlweg steht am Beitrag (Plan N1 E3): Ein Beitrag mit Überweisungsbrief wird gemahnt, auch nach dem Wechsel.
      const mandateId = mandateForChargeInternal(db, charge, asOf);
      if (mandateId) {
        const mandate = mandateRowInternal(db, mandateId);
        const state = mandate ? mandateState(mandate, asOf) : 'ended';
        if (state === 'active') hold = 'directDebit';
      }
    }
    if (hold === null && draftSettlementCentsInternal(db, item.id) > 0) hold = 'draftPayment';
    out.push({ charge, item, dueOn, openCents, hold, returnedOn });
  }
  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.charge.periodStart.localeCompare(b.charge.periodStart));
}

/** Die Mahnvermerke, die noch zählen: Ihr Dokument ist nicht storniert, und mindestens ein Posten darin ist noch offen. */
function countingNotices(db: DbOrTx, membershipId: string, openChargeIds: ReadonlySet<string>): DunningNoticeRow[] {
  const notices = db.select().from(memberDunningNotices).where(eq(memberDunningNotices.membershipId, membershipId)).all();
  const voided = new Set(notices.length ? db.select({ id: documents.id }).from(documents).where(and(inArray(documents.id, notices.map((n) => n.documentId)), eq(documents.status, 'voided'))).all().map((d) => d.id) : []);
  return notices.filter((n) => !voided.has(n.documentId) && n.chargeIds.some((id) => openChargeIds.has(id)));
}

/** Was ein Mitglied im Mahnlauf ergibt: je nächster Stufe ein Brief (meist einer) und, was nicht gemahnt wird, mit Grund. */
type Assessment = { ready: DunningCandidate[]; skipped: DunningSkipReason | null };

/** Welche Gründe vorgehen, wenn mehrere Beiträge aus verschiedenen Gründen nicht gemahnt werden. */
const SKIP_ORDER: readonly DunningSkipReason[] = ['paymentDraft', 'deferred', 'directDebit', 'previousNotSent', 'lastLevelReached'];

/**
 * Wo eine Mitgliedschaft im Mahnlauf zum Stichtag steht (Spec § 4.5, Handoff 2.5; Plan N1 E2). Die Stufe gilt je
 * Beitrag: Sie folgt aus den Mahnvermerken, die diesen Beitrag nennen — ein Beitrag ohne Erinnerung bekommt nie eine
 * höhere Stufe. Nach einer Stundung beginnt die Zählung neu: Vermerke vor der neuen Fälligkeit zählen für ihn nicht.
 * Je nächster Stufe entsteht ein Brief mit genau ihren Beiträgen.
 */
function assess(db: DbOrTx, deps: Deps, row: MembershipRow, name: string, asOf: string, levels: DunningLevel[]): Assessment | null {
  const first = levels[0]!;
  const open = openChargesOf(db, deps, row.id, asOf);
  if (open.length === 0) return null;
  // Die erste Stufe zählt ab der Frist, die das Mitglied genannt bekommen haben kann: die Fälligkeit, frühestens aber
  // der Tag, an dem der Posten angelegt wurde, plus Zahlungsziel. Ein rückwirkend angelegter Beitrag (Aufnahme oder
  // Beitragsänderung nach der Fälligkeit) wird so nicht am Tag der Erfassung reif (Befund 2026-10-18).
  const termDays = readSetting<number>(deps, 'members.paymentTermDays');
  const startOf = (c: OpenCharge) => {
    const term = addDays(c.item.itemDate, termDays);
    return c.dueOn > term ? c.dueOn : term;
  };
  const ripeByDate = (c: OpenCharge) => addDays(startOf(c), first.daysAfter) <= asOf;
  const reasons = new Set<DunningSkipReason>();
  if (open.some((c) => c.hold === null && c.charge.deferredTo !== null && !ripeByDate(c))) reasons.add('deferred');
  if (open.some((c) => c.hold === 'directDebit' && ripeByDate(c))) reasons.add('directDebit');
  // R6: Eine Zahlung liegt als Entwurf vor — das Mitglied bleibt sichtbar, damit der Entwurf nicht liegen bleibt.
  if (open.some((c) => c.hold === 'draftPayment' && ripeByDate(c))) reasons.add('paymentDraft');
  const ripe = open.filter((c) => c.hold === null && ripeByDate(c));
  const notices = countingNotices(db, row.id, new Set(open.map((c) => c.charge.id)));
  const order = levels.map((l) => l.key);
  const sent = dispatchMap(db, notices.map((n) => n.documentId));
  const byLevel = new Map<string, OpenCharge[]>();
  for (const c of ripe) {
    const own = notices.filter((n) => n.chargeIds.includes(c.charge.id) && (c.charge.deferredTo === null || n.issuedOn >= c.charge.deferredTo));
    const latest = [...own].sort((a, b) => order.indexOf(a.levelKey) - order.indexOf(b.levelKey) || a.issuedOn.localeCompare(b.issuedOn)).at(-1);
    if (latest && !sent.get(latest.documentId)) {
      reasons.add('previousNotSent');
      continue;
    }
    const reached = reachedLevel(own, (id) => sent.get(id) ?? null, order);
    const index = reached ? order.indexOf(reached.levelKey) : -1;
    if (index === levels.length - 1) {
      reasons.add('lastLevelReached');
      continue;
    }
    const next = levels[index + 1]!;
    if (reached && addDays(reached.sentOn, next.daysAfter) > asOf) continue;
    byLevel.set(next.key, [...(byLevel.get(next.key) ?? []), c]);
  }
  const ready = levels.flatMap((level) => {
    const charges = byLevel.get(level.key);
    if (!charges) return [];
    return [
      {
        membershipId: row.id,
        memberNumber: row.memberNumber ?? '',
        name,
        levelKey: level.key,
        levelName: levelName(deps, level),
        chargeIds: charges.map((c) => c.charge.id),
        sumCents: charges.reduce((s, c) => s + c.openCents, 0),
        returnedOn: charges.map((c) => c.returnedOn).filter((d): d is string => d !== null).sort().at(-1) ?? null,
      },
    ];
  });
  const skipped = SKIP_ORDER.find((r) => reasons.has(r)) ?? null;
  return ready.length === 0 && skipped === null ? null : { ready, skipped };
}

const fold = (s: string) => s.toLocaleLowerCase('de').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Könnte ein noch nicht zugeordneter Eingang der letzten 30 Tage diese Zahlung sein (Review Focus 1)? Ja bei gleichem
 * Betrag wie die Summe oder ein Posten, bei einer bekannten IBAN des Kontakts oder des Mandats, oder wenn der Name der
 * Gegenpartei den Namen des Kontakts enthält.
 */
function matchingPayments(db: DbOrTx, row: MembershipRow, candidate: DunningCandidate, incoming: FinanceRawTransactionRow[]): string[] {
  const contactIds = [row.contactId, ...(row.guardianContactId ? [row.guardianContactId] : [])];
  const people = db.select().from(contacts).where(inArray(contacts.id, contactIds)).all();
  const names = people.map((c) => fold(c.kind === 'person' ? (c.lastName ?? '') : displayName(c))).filter((n) => n.length >= 3);
  const ibans = new Set(db.select({ iban: financeContactBankAccounts.iban }).from(financeContactBankAccounts).where(inArray(financeContactBankAccounts.contactId, contactIds)).all().map((r) => normalizeIban(r.iban)));
  const agreement = agreementAt(db, row.id, candidate.chargeIds.length ? db.select({ d: memberFeeCharges.dueOn }).from(memberFeeCharges).where(eq(memberFeeCharges.id, candidate.chargeIds[0]!)).get()!.d : '9999-12-31');
  const mandate = agreement?.mandateId ? mandateRowInternal(db, agreement.mandateId) : undefined;
  if (mandate) ibans.add(normalizeIban(mandate.iban));
  const amounts = new Set([candidate.sumCents, ...candidate.chargeIds.map((id) => openCentsInternal(db, db.select({ o: memberFeeCharges.openItemId }).from(memberFeeCharges).where(eq(memberFeeCharges.id, id)).get()!.o!))]);
  return incoming
    .filter((t) => amounts.has(t.amountCents) || (t.counterpartyIban !== null && ibans.has(normalizeIban(t.counterpartyIban))) || (t.counterpartyName !== null && names.some((n) => fold(t.counterpartyName!).includes(n))))
    .map((t) => t.id);
}

function previewInternal(deps: Deps, asOf: string): DunningPreview {
  const db = deps.db;
  const levels = readSetting<DunningLevel[]>(deps, 'members.dunningLevels');
  const memberships = db.select().from(memberMemberships).where(isNotNull(memberMemberships.memberNumber)).all().sort((a, b) => (a.memberNumber ?? '').localeCompare(b.memberNumber ?? ''));
  const names = new Map(memberships.length ? db.select().from(contacts).where(inArray(contacts.id, memberships.map((m) => m.contactId))).all().map((c) => [c.id, displayName(c)]) : []);
  const from = addDays(asOf, -MATCH_WINDOW_DAYS);
  const incoming = openRawTransactionsInternal(db).filter((t) => t.amountCents > 0 && t.bookingDate > from && t.bookingDate <= asOf);
  const out: DunningPreview = { asOf, ready: [], paymentMayMatch: [], skipped: [] };
  for (const row of memberships) {
    const name = names.get(row.contactId) ?? '';
    const assessed = assess(db, deps, row, name, asOf, levels);
    if (!assessed) continue;
    // Was nicht gemahnt wird, steht auch dann unter „übersprungen“, wenn andere Beiträge desselben Mitglieds reif sind (M20).
    if (assessed.skipped) out.skipped.push({ membershipId: row.id, memberNumber: row.memberNumber ?? '', name, reason: assessed.skipped });
    for (const candidate of assessed.ready) {
      const matches = matchingPayments(db, row, candidate, incoming);
      if (matches.length > 0) out.paymentMayMatch.push({ ...candidate, rawTransactionIds: matches });
      else out.ready.push(candidate);
    }
  }
  return out;
}

/** Vorschau des Mahnlaufs zum Stichtag: reif, „Zahlung könnte passen“, übersprungen mit Grund. `members.read`. */
export async function previewDunningRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DunningPreview>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, dunningPreviewSchema, input);
  if (!parsed.ok) return parsed;
  return ok(previewInternal(deps, parsed.value.asOf));
}

const runRefOf = (runId: string) => `membersDunningRun:${runId}`;

/** Ein Brief des Laufs ist je Mitglied und Stufe einer (Plan N1 E2). */
const letterKey = (c: { membershipId: string; levelKey: string }) => `${c.membershipId}:${c.levelKey}`;
const issuedInRun = (db: DbOrTx, runId: string) => new Set(db.select({ membershipId: memberDunningNotices.membershipId, levelKey: memberDunningNotices.levelKey }).from(memberDunningNotices).where(eq(memberDunningNotices.runId, runId)).all().map(letterKey));

function runView(db: DbOrTx, run: DunningRunRow): DunningRunView {
  return { ...run, issued: db.select({ id: memberDunningNotices.id }).from(memberDunningNotices).where(eq(memberDunningNotices.runId, run.id)).all().length };
}

/** Mahnlauf starten (nur ein Mensch, `members.fees`): hält Stichtag fest; die Briefe entstehen in `continueDunningRun`. */
export async function startDunningRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DunningRunView>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, dunningStartSchema, input);
  if (!parsed.ok) return parsed;
  const { asOf } = parsed.value;
  // R1: Die Vorschau darf vorausschauen, der Lauf nicht — er mahnte sonst vor Ablauf einer Frist, die schon ein Brief nannte.
  if (asOf > todayIn(deps)) return invalid([{ path: 'asOf', message: 'inFuture' }]);
  if (deps.db.select({ id: memberDunningRuns.id }).from(memberDunningRuns).where(eq(memberDunningRuns.status, 'running')).get()) return membersConflict('dunningRunRunning');
  const preview = previewInternal(deps, asOf);
  const count = preview.ready.length;
  // M43: Wartet nur noch, wer eine passende Zahlung haben könnte, sagt der Start das statt „nichts reif“.
  const waiting = new Set(preview.paymentMayMatch.map((c) => c.membershipId)).size;
  if (count === 0 && waiting > 0) return membersConflict('dunningRunWaitingForMatch', { count: waiting });
  if (count === 0) return membersConflict('dunningRunNothingReady');
  return deps.db.transaction((tx: DbOrTx) => {
    const run: DunningRunRow = { id: newId(), asOf, status: 'running', refused: [], createdByUserId: ctx.userId ?? null, createdAt: isoNow(deps.clock), finishedAt: null };
    tx.insert(memberDunningRuns).values(run).run();
    recordAudit(tx, deps, ctx, { action: 'members.dunningRun.start', entityType: 'memberDunningRun', entityId: run.id, after: { asOf, count }, params: { asOfOn: asOf, count } });
    return ok(runView(tx, run));
  });
}

/**
 * Mahnlauf fortsetzen (nur ein Mensch, `members.fees`): je reifem Mitglied ein Brief über alle reifen Posten, höchstens
 * `max` je Aufruf, je Brief mit Mahnvermerk in der Transaktion des Ausstellens. Die Vorschau wird zum Stichtag neu
 * gerechnet; wer inzwischen gezahlt hat oder für den ein Eingang passen könnte, fällt heraus.
 */
export async function continueDunningRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DunningRunView>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, dunningContinueSchema, input);
  if (!parsed.ok) return parsed;
  const run = deps.db.select().from(memberDunningRuns).where(eq(memberDunningRuns.id, parsed.value.runId)).get();
  if (!run) return notFound('memberDunningRun', parsed.value.runId);
  if (run.status !== 'running') return membersConflict('dunningRunDone');
  const levels = readSetting<DunningLevel[]>(deps, 'members.dunningLevels');
  const refused: DunningRunRow['refused'] = [];
  const done = issuedInRun(deps.db, run.id);
  const pending = () => previewInternal(deps, run.asOf).ready.filter((c) => !done.has(letterKey(c)) && ![...run.refused, ...refused].some((r) => r.membershipId === c.membershipId));
  for (const candidate of pending().slice(0, parsed.value.max)) {
    const level = levels.find((l) => l.key === candidate.levelKey)!;
    const snippet = level.snippetId ? deps.db.select().from(documentSnippets).where(eq(documentSnippets.id, level.snippetId)).get() : undefined;
    const issued = await issueMemberLetterInternal(
      deps,
      ctx,
      { kind: 'reminder', membershipId: candidate.membershipId, data: { levelName: candidate.levelName, levelText: snippet?.isActive ? snippet.body : null, chargeIds: candidate.chargeIds, returnedOn: candidate.returnedOn } },
      {
        afterIssue: (tx, doc, contactId) => {
          // N7: Ein zweiter Abschnitt desselben Laufs (Neu laden, zweiter Tab) verwirft seine Mahnung still — je Mitglied und Stufe ein Brief.
          if (issuedInRun(tx, run.id).has(letterKey(candidate))) abortIssue(membersConflict('runLetterExists'));
          tx.insert(memberDunningNotices).values({ id: newId(), membershipId: candidate.membershipId, levelKey: candidate.levelKey, documentId: doc.id, chargeIds: candidate.chargeIds, runId: run.id, issuedOn: run.asOf }).run();
          recordRunLetterInternal(tx, deps, { runRef: runRefOf(run.id), membershipId: candidate.membershipId, documentId: doc.id, contactId });
        },
      },
    );
    if (issued.ok || ('code' in issued.error && issued.error.code === 'runLetterExists')) done.add(letterKey(candidate));
    else refused.push({ membershipId: candidate.membershipId, code: 'code' in issued.error && typeof issued.error.code === 'string' ? issued.error.code : issued.error.type });
  }
  return deps.db.transaction((tx: DbOrTx) => {
    // N7: Der Stand von jetzt, nicht der vor dem Ausstellen — ein anderer Abschnitt kann inzwischen geschrieben haben.
    const stored = tx.select().from(memberDunningRuns).where(eq(memberDunningRuns.id, run.id)).get()!;
    if (stored.status !== 'running') return ok(runView(tx, stored));
    const merged = mergeRefused(stored.refused, refused);
    const finished = previewInternal(deps, run.asOf).ready.filter((c) => !issuedInRun(tx, run.id).has(letterKey(c)) && !merged.some((r) => r.membershipId === c.membershipId)).length === 0;
    const current: DunningRunRow = { ...stored, refused: merged, ...(finished ? { status: 'done' as const, finishedAt: isoNow(deps.clock) } : {}) };
    tx.update(memberDunningRuns).set({ refused: current.refused, status: current.status, finishedAt: current.finishedAt }).where(eq(memberDunningRuns.id, run.id)).run();
    const view = runView(tx, current);
    if (finished) recordAudit(tx, deps, ctx, { action: 'members.dunningRun.finish', entityType: 'memberDunningRun', entityId: run.id, after: { issued: view.issued, refused: merged.length }, params: { asOfOn: run.asOf, count: view.issued } });
    return ok(view);
  });
}

/** Die Mahnläufe, jüngste zuerst („Frühere Läufe“). `members.read`. */
export async function listDunningRuns(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: DunningRunView[]; total: number }>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, runListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(memberDunningRuns).all().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return ok({ items: rows.slice(parsed.value.offset, parsed.value.offset + parsed.value.limit).map((r) => runView(deps.db, r)), total: rows.length });
}

/** Ein Mahnlauf mit Zählern; solange er läuft, wie viele Briefe noch ausstehen. `members.read`. */
export async function getDunningRun(deps: Deps, ctx: CallContext, runId: string): Promise<Result<DunningRunDetail>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const run = deps.db.select().from(memberDunningRuns).where(eq(memberDunningRuns.id, runId)).get();
  if (!run) return notFound('memberDunningRun', runId);
  const view = runView(deps.db, run);
  if (run.status !== 'running') return ok({ ...view, remaining: 0 });
  const done = issuedInRun(deps.db, run.id);
  const remaining = previewInternal(deps, run.asOf).ready.filter((c) => !done.has(letterKey(c)) && !run.refused.some((r) => r.membershipId === c.membershipId)).length;
  return ok({ ...view, remaining });
}
