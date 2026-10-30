import { isoNow, newId, notFound, ok, readSetting, recordAudit, requireHumanChannel, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { categoryIdByKeyInternal, createOriginOpenItem } from '@kompass/module-finance';
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { paymentMethodAt } from './payment-method';
import { feeScheduleAt } from './fee-schedule';
import { agreementAt, effectiveFee, typeAt } from './fee-agreement';
import { computeCharges, type ComputedCharge, type JoinYearRule } from './fee-calc';
import { feePaymentReference } from './fee-period';
import { catchAborted, MembersAborted, membersConflict } from './errors';
import { FEE_RUN_NOTICES, memberFeeCharges, memberFeeRuns, memberMemberships, memberRunLetters, type FeeChargeRow, type FeeRunRow, type MembershipRow } from './schema';
import { issueMemberLetterInternal } from './letters/issue';
import { abortIssue } from '@kompass/module-dms';
import { mergeRefused, recordRunLetterInternal, runLetterExistsInternal } from './run-dispatch';
import { addDays } from './letters/shared';

const HUMAN_ONLY_SETTING = 'members.mcpHumanOnlyAllowed';
export const FEE_ORIGIN = 'memberFeeCharge';
export const FEE_CATEGORY_KEY = 'membership-fees';

export type FeeRunOutcome = 'create' | 'exists' | 'exempt' | 'noRule';
export interface PlannedCharge extends ComputedCharge {
  outcome: FeeRunOutcome;
}

export const feeRunPreviewSchema = z.object({ year: z.number().int().min(2000).max(9999) });
/** `notices`: wer eine Beitragsmitteilung bekommt; Lastschrift-Zahler immer, weil sie die Ankündigung ist (Entscheid F3). */
export const feeRunStartSchema = feeRunPreviewSchema.extend({ notices: z.enum(FEE_RUN_NOTICES).default('directDebitOnly') });
export const feeRunContinueSchema = z.object({ runId: z.string().min(1), max: z.number().int().min(1).max(50).default(10) });

export interface FeeRunPreviewItem {
  membershipId: string;
  memberNumber: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  amountCents: number;
  dueOn: string;
  outcome: FeeRunOutcome;
}
export interface FeeRunPreview {
  year: number;
  items: FeeRunPreviewItem[];
  totals: { count: number; sumCents: number };
  /** Lastschrift-Zahler, deren erster Einzug näher liegt als die Frist der Ankündigung (`finance.sepa.preNotificationDays`). */
  prenotificationLate: { membershipId: string; memberNumber: string; firstDueOn: string }[];
}
/** `skippedYearClosed`: Beiträge, deren offene Zahlung in einem abgeschlossenen Geschäftsjahr läge (Rechenschaft D1 Task 10b). */
export type FeeRunView = FeeRunRow & { pending: number; created: number; skippedYearClosed: number; noticesIssued: number };

/** Ob eine Mitgliedschaft im Jahr Beiträge tragen kann: aufgenommen, begonnen bis Jahresende, nicht vor Jahresbeginn beendet. */
export function chargeableIn(row: MembershipRow, year: number): boolean {
  if (!row.joinedOn || !row.memberNumber || row.rejectedOn) return false;
  return row.joinedOn <= `${year}-12-31` && (row.endsOn === null || row.endsOn >= `${year}-01-01`);
}

/** Die Rechnung für eine Mitgliedschaft und ein Jahr, aus Art-Verlauf, Ordnung, Vereinbarung und Einstellung. */
export function computeChargesFor(db: DbOrTx, deps: Deps, row: MembershipRow, year: number): ComputedCharge[] {
  if (!chargeableIn(row, year)) return [];
  return computeCharges({
    year,
    joinedOn: row.joinedOn!,
    endsOn: row.endsOn,
    joinYearRule: readSetting<JoinYearRule>(deps, 'members.joinYearRule'),
    // Eine Vereinbarung „erlassen“ und ein Betrag von 0 machen den Zeitraum beitragsfrei wie die Art.
    typeAt: (day) => {
      const type = typeAt(db, row.id, day) ?? { typeId: '', exempt: false };
      const fee = effectiveFee(db, row.id, day);
      return { typeId: type.typeId, exempt: type.exempt || agreementAt(db, row.id, day)?.reduction === 'waived' || ('amountCents' in fee && fee.amountCents === 0) };
    },
    feeAt: (_typeId, day) => {
      const fee = effectiveFee(db, row.id, day);
      return 'none' in fee || fee.exempt ? null : { amountCents: fee.amountCents, interval: fee.interval };
    },
  });
}

/** Die nicht ersetzten Beitragszeilen einer Mitgliedschaft in einem Jahr. */
export function liveChargesIn(db: DbOrTx, membershipId: string, year: number): FeeChargeRow[] {
  return db
    .select()
    .from(memberFeeCharges)
    .where(and(eq(memberFeeCharges.membershipId, membershipId), ne(memberFeeCharges.state, 'replaced')))
    .all()
    .filter((c) => c.periodStart.startsWith(`${year}-`));
}

/** Was im Jahr anfällt und was davon schon angelegt (oder im Lauf vorgemerkt) ist. */
export function plannedChargesInternal(db: DbOrTx, deps: Deps, row: MembershipRow, year: number): PlannedCharge[] {
  const existing = new Set(liveChargesIn(db, row.id, year).map((c) => c.periodStart));
  return computeChargesFor(db, deps, row, year).map((c) => ({ ...c, outcome: c.skip ?? (existing.has(c.periodStart) ? 'exists' : 'create') }));
}

function feeCategoryOrAbort(db: DbOrTx): string {
  const categoryId = categoryIdByKeyInternal(db, FEE_CATEGORY_KEY);
  if (!categoryId) throw new MembersAborted(membersConflict('membershipFeeCategoryMissing'));
  return categoryId;
}

/** Legt zum Beitrag den offenen Posten der Finanzen an (Herkunft `memberFeeCharge`). Bricht die Transaktion bei Ablehnung ab. */
export function createOpenItemForChargeInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, charge: FeeChargeRow, membership: MembershipRow, categoryId: string): void {
  const created = createOriginOpenItem(tx, deps, ctx, {
    originType: FEE_ORIGIN,
    originId: charge.id,
    contactId: membership.contactId,
    amountCents: charge.amountCents,
    itemDate: todayIn(deps),
    dueOn: charge.dueOn,
    paymentReference: feePaymentReference(charge.periodStart, charge.periodEnd, membership.memberNumber!),
    lineTemplate: [{ categoryId, amountCents: charge.amountCents, contactId: membership.contactId }],
  });
  // Rechenschaft D1 Task 10b: Ein abgeschlossenes Geschäftsjahr nimmt keine offene Zahlung mehr an — der Beitrag wird
  // im Lauf als „übersprungen: Jahr abgeschlossen“ gezählt, statt den ganzen Lauf abzubrechen.
  if (!created.ok && created.error.type === 'conflict' && created.error.code === 'fiscalYearClosed') {
    tx.update(memberFeeCharges).set({ state: 'skipped', skipReason: 'fiscalYearClosed' }).where(eq(memberFeeCharges.id, charge.id)).run();
    return;
  }
  if (!created.ok) throw new MembersAborted(created);
  tx.update(memberFeeCharges).set({ state: 'created', openItemId: created.value.id }).where(eq(memberFeeCharges.id, charge.id)).run();
}

/** Eine neue Beitragszeile; ohne Lauf sofort mit Posten, im Lauf vorgemerkt (`pending`). */
export function insertChargeInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, membership: MembershipRow, c: ComputedCharge, runId: string | null, categoryId: string | null): FeeChargeRow {
  // Der Zahlweg der Vereinbarung an der Fälligkeit bleibt am Beitrag (Plan N1 E3).
  // M4: Der Stand, der an der Fälligkeit galt (im Eintrittszeitraum der Eintritt), hat den Beitrag bestimmt.
  const scheduleId = feeScheduleAt(tx, c.dueOn)?.id ?? null;
  const row: FeeChargeRow = { id: newId(), membershipId: membership.id, periodStart: c.periodStart, periodEnd: c.periodEnd, amountCents: c.amountCents, dueOn: c.dueOn, deferredTo: null, openItemId: null, runId, state: 'pending', skipReason: null, replacedById: null, paymentMethod: paymentMethodAt(tx, membership.id, c.dueOn), scheduleId };
  tx.insert(memberFeeCharges).values(row).run();
  if (runId === null) createOpenItemForChargeInternal(tx, deps, ctx, row, membership, categoryId ?? feeCategoryOrAbort(tx));
  return row;
}

/**
 * Legt die noch fehlenden Beiträge eines Jahres für eine Mitgliedschaft an — gemeinsam für Aufnahme (ohne Lauf: sofort
 * mit offenem Posten) und Lauf (vorgemerkt, die Posten entstehen in `continueFeeRun`). Wirft `MembersAborted`.
 */
export function createChargesForMembershipInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, membershipId: string, year: number, runId: string | null): number {
  const membership = tx.select().from(memberMemberships).where(eq(memberMemberships.id, membershipId)).get();
  if (!membership) return 0;
  const toCreate = plannedChargesInternal(tx, deps, membership, year).filter((p) => p.outcome === 'create');
  if (toCreate.length === 0) return 0;
  const categoryId = runId === null ? feeCategoryOrAbort(tx) : null;
  for (const c of toCreate) insertChargeInternal(tx, deps, ctx, membership, c, runId, categoryId);
  return toCreate.length;
}

/** Ob die Aufnahme die Beiträge des Eintrittsjahres gleich anlegt: Jahr bis heute oder ein Lauf fürs Jahr existiert. */
export function admissionCreatesFees(db: DbOrTx, deps: Deps, year: number): boolean {
  return year <= Number(todayIn(deps).slice(0, 4)) || !!db.select({ id: memberFeeRuns.id }).from(memberFeeRuns).where(eq(memberFeeRuns.year, year)).get();
}

const sortByNumber = (rows: MembershipRow[]) => [...rows].sort((a, b) => (a.memberNumber ?? '').localeCompare(b.memberNumber ?? '') || a.id.localeCompare(b.id));

const feeRunRef = (runId: string) => `membersFeeRun:${runId}`;

function runView(db: DbOrTx, run: FeeRunRow): FeeRunView {
  const rows = db.select({ state: memberFeeCharges.state, skipReason: memberFeeCharges.skipReason }).from(memberFeeCharges).where(eq(memberFeeCharges.runId, run.id)).all();
  const noticesIssued = db.select({ id: memberRunLetters.id }).from(memberRunLetters).where(eq(memberRunLetters.runRef, feeRunRef(run.id))).all().length;
  return { ...run, pending: rows.filter((r) => r.state === 'pending').length, created: rows.filter((r) => r.state === 'created').length, skippedYearClosed: rows.filter((r) => r.state === 'skipped' && r.skipReason === 'fiscalYearClosed').length, noticesIssued };
}

/** Zahlt die Mitgliedschaft die Beiträge ab `on` per Lastschrift (mit Mandat)? */
const paysByDirectDebit = (db: DbOrTx, membershipId: string, on: string): boolean => {
  const agreement = agreementAt(db, membershipId, on);
  return agreement?.paymentMethod === 'directDebit' && !!agreement.mandateId;
};

/** Mitgliedschaften des Laufs, die noch eine Beitragsmitteilung bekommen (Plan M4 Task 5). */
function noticesDue(db: DbOrTx, run: FeeRunRow): string[] {
  const charges = db.select().from(memberFeeCharges).where(and(eq(memberFeeCharges.runId, run.id), eq(memberFeeCharges.state, 'created'))).all();
  const issued = new Set(db.select({ m: memberRunLetters.membershipId }).from(memberRunLetters).where(eq(memberRunLetters.runRef, feeRunRef(run.id))).all().map((r) => r.m));
  const refused = new Set(run.noticeRefused.map((r) => r.membershipId));
  const firstDue = new Map<string, string>();
  for (const c of charges) if (!firstDue.has(c.membershipId) || c.dueOn < firstDue.get(c.membershipId)!) firstDue.set(c.membershipId, c.dueOn);
  const memberships = new Map(firstDue.size ? db.select().from(memberMemberships).where(inArray(memberMemberships.id, [...firstDue.keys()])).all().map((m) => [m.id, m]) : []);
  return [...firstDue.entries()]
    .filter(([id, due]) => !issued.has(id) && !refused.has(id) && (run.notices === 'all' || paysByDirectDebit(db, id, due)))
    .sort(([a], [b]) => (memberships.get(a)?.memberNumber ?? '').localeCompare(memberships.get(b)?.memberNumber ?? ''))
    .map(([id]) => id);
}

/** Vorschau des Beitragslaufs: je Mitgliedschaft die Zeiträume mit Betrag, Fälligkeit und was mit ihnen geschieht. */
export async function previewFeeRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FeeRunPreview>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, feeRunPreviewSchema, input);
  if (!parsed.ok) return parsed;
  const { year } = parsed.value;
  const memberships = sortByNumber(deps.db.select().from(memberMemberships).where(isNotNull(memberMemberships.memberNumber)).all().filter((r) => chargeableIn(r, year)));
  const contactIds = [...new Set(memberships.map((m) => m.contactId))];
  const names = new Map(contactIds.length ? deps.db.select().from(contacts).where(inArray(contacts.id, contactIds)).all().map((c) => [c.id, displayName(c)]) : []);
  const items: FeeRunPreviewItem[] = memberships.flatMap((m) =>
    plannedChargesInternal(deps.db, deps, m, year).map((p) => ({ membershipId: m.id, memberNumber: m.memberNumber!, name: names.get(m.contactId) ?? '', periodStart: p.periodStart, periodEnd: p.periodEnd, amountCents: p.amountCents, dueOn: p.dueOn, outcome: p.outcome })),
  );
  const create = items.filter((i) => i.outcome === 'create');
  // Die Mitteilung kündigt die Einzüge an: Liegt der erste näher als die Frist, deckt sie ihn nicht (Spec § 7.5).
  const latest = addDays(todayIn(deps), readSetting<number>(deps, 'finance.sepa.preNotificationDays'));
  const prenotificationLate = memberships.flatMap((m) => {
    const first = create.filter((i) => i.membershipId === m.id).map((i) => i.dueOn).sort()[0];
    return first && first < latest && paysByDirectDebit(deps.db, m.id, first) ? [{ membershipId: m.id, memberNumber: m.memberNumber!, firstDueOn: first }] : [];
  });
  return ok({ year, items, totals: { count: create.length, sumCents: create.reduce((s, i) => s + i.amountCents, 0) }, prenotificationLate });
}

/** Beitragslauf starten (nur ein Mensch): hält die anzulegenden Beiträge als `pending` fest. */
export async function startFeeRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FeeRunView>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, feeRunStartSchema, input);
  if (!parsed.ok) return parsed;
  const { year, notices } = parsed.value;
  if (deps.db.select({ id: memberFeeRuns.id }).from(memberFeeRuns).where(and(eq(memberFeeRuns.year, year), eq(memberFeeRuns.status, 'running'))).get()) return membersConflict('feeRunRunning', { year });
  if (!categoryIdByKeyInternal(deps.db, FEE_CATEGORY_KEY)) return membersConflict('membershipFeeCategoryMissing');
  const memberships = sortByNumber(deps.db.select().from(memberMemberships).where(isNotNull(memberMemberships.memberNumber)).all().filter((r) => chargeableIn(r, year)));
  const result = catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      const run: FeeRunRow = { id: newId(), year, status: 'running', notices, noticeRefused: [], createdByUserId: ctx.userId ?? null, createdAt: isoNow(deps.clock), finishedAt: null };
      tx.insert(memberFeeRuns).values(run).run();
      const count = memberships.reduce((n, m) => n + createChargesForMembershipInternal(tx, deps, ctx, m.id, year, run.id), 0);
      if (count === 0) throw new MembersAborted(membersConflict('feeRunNothingToCreate', { year }));
      recordAudit(tx, deps, ctx, { action: 'members.feeRun.start', entityType: 'memberFeeRun', entityId: run.id, after: { year, count }, params: { year, count } });
      return ok(runView(tx, run));
    }),
  );
  return result;
}

/**
 * Beitragslauf fortsetzen (nur ein Mensch): höchstens `max` Beiträge je Aufruf, je mit offenem Posten — alles oder
 * nichts. Sind alle Posten angelegt, folgen die Beitragsmitteilungen (Plan M4 Task 5), wieder höchstens `max`, je Brief
 * in eigener Transaktion; fertig ist der Lauf, wenn keine mehr aussteht.
 */
export async function continueFeeRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FeeRunView>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, feeRunContinueSchema, input);
  if (!parsed.ok) return parsed;
  const run = deps.db.select().from(memberFeeRuns).where(eq(memberFeeRuns.id, parsed.value.runId)).get();
  if (!run) return notFound('memberFeeRun', parsed.value.runId);
  if (run.status !== 'running') return membersConflict('feeRunDone');
  const charged = catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      const pending = tx.select().from(memberFeeCharges).where(and(eq(memberFeeCharges.runId, run.id), eq(memberFeeCharges.state, 'pending'))).orderBy(asc(memberFeeCharges.membershipId), asc(memberFeeCharges.periodStart)).all();
      if (pending.length === 0) return ok(0);
      const categoryId = feeCategoryOrAbort(tx);
      const memberships = new Map(tx.select().from(memberMemberships).where(inArray(memberMemberships.id, [...new Set(pending.map((p) => p.membershipId)), ''])).all().map((m) => [m.id, m]));
      const ordered = [...pending].sort((a, b) => (memberships.get(a.membershipId)?.memberNumber ?? '').localeCompare(memberships.get(b.membershipId)?.memberNumber ?? '') || a.periodStart.localeCompare(b.periodStart));
      for (const charge of ordered.slice(0, parsed.value.max)) createOpenItemForChargeInternal(tx, deps, ctx, charge, memberships.get(charge.membershipId)!, categoryId);
      return ok(Math.max(0, ordered.length - parsed.value.max));
    }),
  );
  if (!charged.ok) return charged;
  if (charged.value > 0) return ok(runView(deps.db, run));

  const refused: FeeRunRow['noticeRefused'] = [];
  for (const membershipId of noticesDue(deps.db, run).slice(0, parsed.value.max)) {
    const issued = await issueMemberLetterInternal(deps, ctx, { kind: 'feeNotice', membershipId, data: { year: run.year } }, {
      afterIssue: (tx, doc, contactId) => {
        // N7: Ein zweiter Abschnitt desselben Laufs (Neu laden, zweiter Tab) verwirft seinen Brief still.
        if (runLetterExistsInternal(tx, feeRunRef(run.id), membershipId)) abortIssue(membersConflict('runLetterExists'));
        recordRunLetterInternal(tx, deps, { runRef: feeRunRef(run.id), membershipId, documentId: doc.id, contactId });
      },
      // R5: Die gesonderte Ankündigung an einen fremden Kontoinhaber geht mit demselben Lauf hinaus, nach dessen Zustellweg.
      afterHolderNotice: (tx, documentId, holderContactId) => recordRunLetterInternal(tx, deps, { runRef: feeRunRef(run.id), membershipId, documentId, contactId: holderContactId }),
    });
    if (!issued.ok && 'code' in issued.error && issued.error.code === 'runLetterExists') continue;
    if (!issued.ok) refused.push({ membershipId, code: 'code' in issued.error && typeof issued.error.code === 'string' ? issued.error.code : issued.error.type });
    // Backlog 78: Die Mitteilung ging hinaus, die Ankündigung an den Kontoinhaber nicht (etwa ohne Finanzrechte) — festhalten statt still.
    else if (issued.value.prenotification && 'refused' in issued.value.prenotification) refused.push({ membershipId, code: issued.value.prenotification.refused, letter: 'prenotification' });
  }
  return deps.db.transaction((tx: DbOrTx) => {
    // N7: Der Stand von jetzt, nicht der vor dem Ausstellen — ein anderer Abschnitt kann inzwischen geschrieben haben.
    const stored = tx.select().from(memberFeeRuns).where(eq(memberFeeRuns.id, run.id)).get()!;
    let current: FeeRunRow = { ...stored, noticeRefused: mergeRefused(stored.noticeRefused, refused) };
    if (stored.status !== 'running') return ok(runView(tx, stored));
    if (noticesDue(tx, current).length === 0) current = { ...current, status: 'done', finishedAt: isoNow(deps.clock) };
    tx.update(memberFeeRuns).set({ noticeRefused: current.noticeRefused, status: current.status, finishedAt: current.finishedAt }).where(eq(memberFeeRuns.id, run.id)).run();
    if (current.status === 'done') {
      const count = runView(tx, current).created;
      recordAudit(tx, deps, ctx, { action: 'members.feeRun.finish', entityType: 'memberFeeRun', entityId: run.id, after: { year: run.year, count }, params: { year: run.year, count } });
    }
    return ok(runView(tx, current));
  });
}

export const runListSchema = z.object({ limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) });

/** Die Beitragsläufe, jüngste zuerst („Frühere Läufe“, Handoff 2.5). `members.read`. */
export async function listFeeRuns(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: FeeRunView[]; total: number }>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, runListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(memberFeeRuns).all().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return ok({ items: rows.slice(parsed.value.offset, parsed.value.offset + parsed.value.limit).map((r) => runView(deps.db, r)), total: rows.length });
}

/** Ein Beitragslauf mit Zählern (`members.read`). */
export async function getFeeRun(deps: Deps, ctx: CallContext, runId: string): Promise<Result<FeeRunView>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const run = deps.db.select().from(memberFeeRuns).where(eq(memberFeeRuns.id, runId)).get();
  return run ? ok(runView(deps.db, run)) : notFound('memberFeeRun', runId);
}
