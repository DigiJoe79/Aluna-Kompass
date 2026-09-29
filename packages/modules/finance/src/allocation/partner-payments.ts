import { purposeGoingNegative, purposeNegativeProblemInternal } from '../ledger/purpose-negative';
import { expectedVersionField, hasPermission, invalid, isoNow, newId, notFound, ok, readSetting, requirePermission, staleVersion, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result, type ValidationIssue } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { documentLinks, linkDocumentInternal } from '@kompass/module-dms';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { checkBasisAllowed, partnerNoticeValidAtInternal } from './partners';
import { activeStepOf, goodsLineInfo, paidLinesOf, paymentsReadyToAcknowledgeInternal, readyForUserInternal, paidLineViewsOf, paidOnOf, partnerProofDeadlinesInternal, positionsOf, positionViewsOf, proofDueOnOf, paymentTotalCents, sumPositionCents, type ActiveStep, type PaidLineView, type PositionView } from './partner-proof';

export { activeStepOf, paymentsReadyToAcknowledgeInternal, paidLineViewsOf, paidOnOf, partnerProofDeadlinesInternal, positionViewsOf, sumPositionCents, type ActiveStep, type PaidLineView, type PositionView };
import { paymentProofSatisfied, proofDueDate, requiredEvidenceKinds, type EvidenceKind, type PartnerBasis } from './evidence-rules';
import { noticeValidUntil } from '../ledger/notice-validity';
import {
  financeAllocationLines,
  financeEntries,
  financePartnerEvidence,
  financePartnerNotices,
  financePartnerPaidLines,
  financePartnerPaymentPositions,
  financePartnerPayments,
  financePartnerProfiles,
  type FinancePartnerPaymentPositionRow,
  type FinancePartnerPaymentRow,
  type FinancePartnerProfileRow,
} from '../schema';

/**
 * Zahlung an Partner — Entwurf, Einreichen, Ablehnen, Kopie (F7 Task 3, Spec
 * 8.1, Annahme 3–8). Alles unter `finance.entriesWrite`, außer Ablehnen
 * (`finance.approve`). Freigeben und Anerkennen der Nachweise gegen Personen
 * ≠ Anleger kommen in Task 4 (Freigabe) und diesem Task (Anerkennen,
 * `evidence.ts`) — beide teilen `ownPaymentProblem` von hier.
 */


/** Version wie bei Auslagen: `updatedAt` selbst ist die Version, nie rückwärts. */
export function nextVersion(deps: Deps, previous: string | undefined): string {
  const now = isoNow(deps.clock);
  if (previous === undefined || now > previous) return now;
  return new Date(Date.parse(previous) + 1).toISOString();
}

function partnerOf(db: DbOrTx, id: string): FinancePartnerProfileRow | undefined {
  return db.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.id, id)).get();
}

/** Annahme 7: ≠ Anleger — geteilt von `approvePartnerPayment` (Task 4) und `acknowledgeEvidence`. */
export function ownPaymentProblem(ctx: CallContext, payment: Pick<FinancePartnerPaymentRow, 'createdByUserId'>): Failure | null {
  return ctx.userId && ctx.userId === payment.createdByUserId ? financeConflict('partnerPaymentOwnCreator') : null;
}



/**
 * Welche Pflichtbegründungen die Zahlung jetzt verlangen würde (Design-Nachtrag
 * Phase 4, Task 1): vorab, damit Entwurf und Freigabe den Warnkasten zeigen,
 * bevor der Dienst ablehnt. Eine schon gegebene Begründung zählt als erledigt.
 * `noticeValidUntil`: Ende des jüngsten Bescheids, für den Satz „(bis …)“.
 */
export interface ReasonsNeeded {
  notice: boolean;
  overdue: boolean;
  /** Befund Q: die Geldpositionen brächten einen Zweck ins Minus — beim Einreichen `purposeReason`. */
  purpose: boolean;
  noticeValidUntil: string | null;
}

export interface PartnerPaymentView extends FinancePartnerPaymentRow {
  partnerName: string;
  /** Die Frist dieser Zahlung in Monaten: eigene oder die übliche des Partners. */
  effectiveProofMonths: number;
  reasonsNeeded: ReasonsNeeded;
  /** Tag der Zahlung (Schritt „gezahlt“): bei nachträglicher Freigabe die älteste bezahlte Zeile, sonst der Tag, an dem der Posten beglichen war. */
  paidOn: string | null;
  positions: PositionView[];
  paidLines: PaidLineView[];
  totalCents: number;
  activeStep: ActiveStep | null;
  requiredEvidenceKinds: EvidenceKind[];
  /**
   * U Rest (Recheck sha-0170e73): Der Aufrufer könnte die Nachweise jetzt
   * anerkennen — Recht „Freigeben“, nicht die eigene Zahlung, gezahlt, alle
   * Pflichtnachweise vollständig. Dieselbe Bedingung wie Kachel „Zu tun“ und
   * `finance_partner_proof_deadlines`.
   */
  readyToAcknowledge: boolean;
  version: string;
}

/** Mit Rechteprüfung: ohne „Freigeben“ ist für niemanden etwas bereit. */
export function readyToAcknowledgeFor(db: DbOrTx, ctx: CallContext, row: FinancePartnerPaymentRow): boolean {
  return hasPermission(ctx, 'finance.approve') && readyForUserInternal(db, row, ctx.userId ?? null);
}

export function partnerPaymentViewInternal(deps: Deps, ctx: CallContext, db: DbOrTx, row: FinancePartnerPaymentRow): PartnerPaymentView {
  return toView(deps, ctx, db, row);
}

function toView(deps: Deps, ctx: CallContext, db: DbOrTx, row: FinancePartnerPaymentRow): PartnerPaymentView {
  const partner = partnerOf(db, row.partnerId)!;
  const contact = db.select().from(contacts).where(eq(contacts.id, partner.contactId)).get()!;
  const positions = positionViewsOf(db, row.id);
  const paidLines = paidLineViewsOf(db, row.id);
  return {
    ...row,
    partnerName: displayName(contact),
    positions,
    paidLines,
    totalCents: paymentTotalCents(row, positions, paidLines),
    activeStep: activeStepOf(db, row),
    requiredEvidenceKinds: requiredEvidenceKindsFor(partner, row, positions),
    readyToAcknowledge: readyToAcknowledgeFor(db, ctx, row),
    effectiveProofMonths: row.proofMonths ?? partner.usualProofMonths,
    reasonsNeeded: reasonsNeededOf(deps, db, partner, row),
    paidOn: paidOnOf(db, row),
    // Task 6c: ab dem Zahlungstag berechnet, nie der gespeicherte Wert.
    proofDueOn: proofDueOnOf(db, row, partner.usualProofMonths),
    version: row.updatedAt,
  };
}

function reasonsNeededOf(deps: Deps, db: DbOrTx, partner: FinancePartnerProfileRow, row: FinancePartnerPaymentRow): ReasonsNeeded {
  const latest = partner.status === 'taxExemptBody'
    ? db.select().from(financePartnerNotices).where(eq(financePartnerNotices.partnerId, partner.id)).all().filter((n) => n.voidedAt === null && n.kind !== 'recognitionAbroad').sort((a, b) => b.noticeDate.localeCompare(a.noticeDate))[0]
    : undefined;
  const noticeValidUntilDate = latest && latest.kind !== 'recognitionAbroad' ? noticeValidUntil(latest.kind, latest.noticeDate) : null;
  if (row.state !== 'draft' && row.state !== 'submitted') return { notice: false, overdue: false, purpose: false, noticeValidUntil: noticeValidUntilDate };
  const date = checkDateFor(deps, row, paidLineViewsOf(db, row.id));
  return {
    notice: !row.noticeReason && noticeReasonNeeded(deps, partner, date),
    overdue: !row.overdueReason && overdueReasonNeeded(deps, partner, row.id),
    // Q Rest: auch eingereicht — der Bestand kann sich bis zur Freigabe geändert haben; eine Begründung vom Einreichen genügt.
    purpose: !row.retroactive && !row.purposeNegativeReason && !!purposeGoingNegative(db, purposeOutflowsOf(positionViewsOf(db, row.id))),
    noticeValidUntil: noticeValidUntilDate,
  };
}

/**
 * Befund Q: was eine Zahlung an Partner einem Zweck entnimmt — die Geldpositionen mit Zweck, als Abgang. Sachpositionen
 * zeigen auf schon gebuchte Einkäufe, und bei nachträglicher Freigabe sind die Zeilen schon gebucht: beide zählen nicht.
 */
export function purposeOutflowsOf(positions: readonly PositionView[]): { purposeId: string | null; amountCents: number }[] {
  return positions.filter((p) => p.kind === 'money' && p.purposeId).map((p) => ({ purposeId: p.purposeId, amountCents: -Math.abs(p.amountCents) }));
}

function requiredEvidenceKindsFor(partner: FinancePartnerProfileRow, payment: Pick<FinancePartnerPaymentRow, 'basis'>, positions: readonly PositionView[]): EvidenceKind[] {
  return requiredEvidenceKinds({ basis: payment.basis, partnerStatus: partner.status, hasGoodsPositions: positions.some((p) => p.kind === 'goods') });
}

// ── Entwurf ─────────────────────────────────────────────────────────────────

const positionInputSchema = z.object({
  id: z.string().min(1).optional(),
  kind: z.enum(['money', 'goods']),
  amountCents: z.number().int().positive().max(100_000_000).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  purposeId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  goodsLineId: z.string().min(1).optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const draftBaseSchema = z.object({
    id: z.string().min(1).optional(),
    expectedVersion: expectedVersionField,
    partnerId: z.string().min(1),
    basis: z.enum(['transfer58', 'agent57']),
    basisOverrideReason: z.string().trim().max(1000).nullable().optional(),
    purposeText: z.string().trim().max(2000).optional(),
    agreementDocumentId: z.string().min(1).nullable().optional(),
    retroactive: z.boolean(),
    /** Nachweisfrist dieser Zahlung in Monaten (Entscheidung 2); `null` oder weggelassen = übliche Frist des Partners. */
    proofMonths: z.number().int().min(1).max(60).nullable().optional(),
    positions: z.array(positionInputSchema).max(100),
    paidLineIds: z.array(z.string().min(1)).max(100).optional(),
  });

/** N5: Welche Position welche Angaben braucht, prüft der Dienst — das Werkzeug zeigt `draftBaseSchema`. */
export const draftSchema = draftBaseSchema.superRefine((v, c) => {
    if (v.retroactive && v.positions.some((p) => p.kind === 'money')) c.addIssue({ code: 'custom', path: ['positions'], message: 'moneyPositionsAutoGenerated' });
    v.positions.forEach((p, i) => {
      if (p.kind === 'goods' && !p.goodsLineId) c.addIssue({ code: 'custom', path: [`positions.${i}.goodsLineId`], message: 'required' });
      if (p.kind === 'money' && (p.amountCents === undefined || p.amountCents <= 0)) c.addIssue({ code: 'custom', path: [`positions.${i}.amountCents`], message: 'required' });
    });
  });

/** Eine an den Partner gezahlte, nicht zurückgenommene, noch freie Zeile — Richtung Ausgabe (Annahme 4); festgeschrieben sein muss sie erst beim Einreichen. */
function eligiblePaidLine(db: DbOrTx, lineId: string, partner: FinancePartnerProfileRow, ownPaymentId: string | undefined): Failure | null {
  const line = db.select().from(financeAllocationLines).where(eq(financeAllocationLines.id, lineId)).get();
  if (!line) return notFound('financeAllocationLine', lineId);
  const entry = db.select().from(financeEntries).where(eq(financeEntries.id, line.entryId)).get();
  // Design-Nachtrag Phase 4, Task 5: auch eine noch nicht festgeschriebene Zeile (aus der Arbeitsliste) darf im Entwurf stehen — eingereicht wird erst, wenn sie festgeschrieben ist.
  const ok = !!entry && entry.reversedByEntryId === null && line.contactId === partner.contactId && line.amountCents < 0;
  if (!ok) return financeConflict('paidLineNotEligible');
  const taken = db.select().from(financePartnerPaidLines).where(eq(financePartnerPaidLines.paidLineId, lineId)).get();
  if (taken && taken.paymentId !== ownPaymentId) return financeConflict('allocationLineAlreadyAssigned');
  return null;
}

export interface EligibleLine {
  id: string;
  entryId: string;
  entryNumber: string | null;
  entryDate: string;
  amountCents: number;
  categoryId: string;
}

/**
 * Kandidaten für die Positionsauswahl der Oberfläche (F7 Task 6b): bei
 * `paidLine` festgeschriebene, an den Partner gezahlte, noch freie Zeilen
 * (Annahme 4); bei `goodsLine` festgeschriebene Ausgabezeilen, aus denen eine
 * Sachposition Betrag und Kategorie liest — mehrfach verwendbar, keine
 * Ausschlüsse. Höchstens 50, jüngste zuerst.
 */
function eligibleLinesInternal(db: DbOrTx, kind: 'paidLine' | 'goodsLine', partner?: FinancePartnerProfileRow): EligibleLine[] {
  const rows = db
    .select({ id: financeAllocationLines.id, entryId: financeAllocationLines.entryId, contactId: financeAllocationLines.contactId, amountCents: financeAllocationLines.amountCents, categoryId: financeAllocationLines.categoryId, entryDate: financeEntries.entryDate, entryNumber: financeEntries.number, status: financeEntries.status, reversedByEntryId: financeEntries.reversedByEntryId })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .orderBy(desc(financeEntries.entryDate))
    .limit(200)
    .all()
    .filter((l) => l.status === 'final' && l.reversedByEntryId === null && l.amountCents < 0);
  const taken = new Set(db.select({ id: financePartnerPaidLines.paidLineId }).from(financePartnerPaidLines).all().map((r) => r.id));
  const candidates = kind === 'paidLine' ? rows.filter((l) => partner && l.contactId === partner.contactId && !taken.has(l.id)) : rows;
  return candidates.slice(0, 50).map((l) => ({ id: l.id, entryId: l.entryId, entryNumber: l.entryNumber, entryDate: l.entryDate, amountCents: l.amountCents, categoryId: l.categoryId }));
}

const eligibleLinesSchema = z.object({ partnerId: z.string().min(1), kind: z.enum(['paidLine', 'goodsLine']) });

/** `finance.read`: Kandidatenzeilen für die Positionsauswahl der Oberfläche. */
export async function listEligibleLines(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EligibleLine[]>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, eligibleLinesSchema, input);
  if (!parsed.ok) return parsed;
  const partner = partnerOf(deps.db, parsed.value.partnerId);
  if (!partner) return notFound('financePartnerProfile', parsed.value.partnerId);
  return ok(eligibleLinesInternal(deps.db, parsed.value.kind, partner));
}

/**
 * Laufende Sicherung (Muster `saveExpenseDraft`): Positionen und Paid-Lines
 * werden als Ganzes ersetzt, solange der Vorgang ein Entwurf ist. Bei
 * `retroactive` werden Geldpositionen nicht hier eingegeben — sie entstehen
 * erst beim Einreichen aus den gewählten Zeilen (Annahme 4).
 */
export async function savePartnerPaymentDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PartnerPaymentView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, draftSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const before = v.id ? deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, v.id)).get() : undefined;
  if (v.id && !before) return notFound('financePartnerPayment', v.id);
  if (before && before.state !== 'draft') return financeConflict('partnerPaymentNotSubmitted');
  if (before) {
    const stale = staleVersion(v.expectedVersion, before.updatedAt);
    if (stale) return stale;
  }
  const partnerId = before?.partnerId ?? v.partnerId;
  const partner = partnerOf(deps.db, partnerId);
  if (!partner) return notFound('financePartnerProfile', partnerId);
  const contact = deps.db.select().from(contacts).where(eq(contacts.id, partner.contactId)).get()!;
  const allowed = checkBasisAllowed(v.basis, partner.status, contact.kind);
  if (allowed) return allowed;
  // Die Begründung einer übersteuerten Art verlangt erst das Einreichen: laufend gesichert wird auch ein halber Stand.

  for (const p of v.positions) {
    if (p.kind === 'goods' && !goodsLineInfo(deps.db, p.goodsLineId!)) return notFound('financeAllocationLine', p.goodsLineId!);
  }
  // Wie bei Auslagen (Teil B, Board-Fund F8a): ein Projekt wählt nur, wer Projekte sehen darf — ein schon gesetztes bleibt stehen.
  // Gemessen an den Projekten des Entwurfs, nicht je Position: Die Oberfläche ersetzt die Positionen ohne ihre IDs.
  const stored = new Set(before ? positionsOf(deps.db, before.id).map((p) => p.projectId).filter((id): id is string => !!id) : []);
  if (v.positions.some((p) => !!p.projectId && !stored.has(p.projectId))) {
    const noProjects = requirePermission(ctx, 'projects.view');
    if (noProjects) return noProjects;
  }
  for (const lineId of v.paidLineIds ?? []) {
    const problem = eligiblePaidLine(deps.db, lineId, partner, before?.id);
    if (problem) return problem;
  }

  return deps.db.transaction((tx: DbOrTx) => {
    const now = nextVersion(deps, before?.updatedAt);
    const paymentId = before?.id ?? newId();
    const fields = {
      partnerId, basis: v.basis as PartnerBasis, basisOverridden: v.basis !== partner.usualBasis, basisOverrideReason: v.basisOverrideReason ?? null,
      purposeText: v.purposeText ?? '', agreementDocumentId: v.agreementDocumentId ?? null, retroactive: v.retroactive, proofMonths: v.proofMonths ?? null, updatedAt: now,
    };
    if (before) tx.update(financePartnerPayments).set(fields).where(eq(financePartnerPayments.id, paymentId)).run();
    else tx.insert(financePartnerPayments).values({ id: paymentId, state: 'draft', createdByUserId: ctx.userId ?? 'system', createdAt: now, ...fields }).run();

    const existing = new Map(before ? positionsOf(tx, paymentId).map((p) => [p.id, p]) : []);
    const kept = new Set(v.positions.map((p) => p.id).filter((id): id is string => !!id));
    for (const id of existing.keys()) if (!kept.has(id)) tx.delete(financePartnerPaymentPositions).where(eq(financePartnerPaymentPositions.id, id)).run();
    v.positions.forEach((p, sortOrder) => {
      const row = { sortOrder, kind: p.kind, amountCents: p.kind === 'money' ? (p.amountCents ?? 0) : null, categoryId: p.kind === 'money' ? (p.categoryId ?? null) : null, purposeId: p.purposeId ?? null, projectId: p.projectId ?? null, goodsLineId: p.kind === 'goods' ? (p.goodsLineId ?? null) : null, note: p.note ?? null };
      if (p.id && existing.has(p.id)) tx.update(financePartnerPaymentPositions).set(row).where(eq(financePartnerPaymentPositions.id, p.id)).run();
      else tx.insert(financePartnerPaymentPositions).values({ id: newId(), paymentId, ...row }).run();
    });

    const existingPaid = new Map(paidLinesOf(tx, paymentId).map((pl) => [pl.paidLineId, pl]));
    const keptPaid = new Set(v.paidLineIds ?? []);
    for (const [lineId, row] of existingPaid) if (!keptPaid.has(lineId)) tx.delete(financePartnerPaidLines).where(eq(financePartnerPaidLines.id, row.id)).run();
    for (const lineId of v.paidLineIds ?? []) if (!existingPaid.has(lineId)) tx.insert(financePartnerPaidLines).values({ id: newId(), paymentId, paidLineId: lineId, createdAt: now }).run();

    const after = tx.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, paymentId)).get()!;
    const positions = positionViewsOf(tx, paymentId);
    const totalCents = paymentTotalCents(after, positions, paidLineViewsOf(tx, paymentId));
    financeAudit(tx, deps, ctx, {
      action: 'finance.partnerPayment.saveDraft', entity: 'financePartnerPayment', id: paymentId,
      after: { state: 'draft', basis: after.basis, basisOverridden: after.basisOverridden, retroactive: after.retroactive, proofMonths: after.proofMonths, positionCount: positions.length, totalCents },
      summary: `Zahlung an Partner (Entwurf) ${paymentId} gesichert`,
    });
    return ok(toView(deps, ctx, tx, after));
  });
}

// ── Einreichen ──────────────────────────────────────────────────────────────

export const submitSchema = z.object({ id: z.string().min(1), expectedVersion: expectedVersionField, noticeReason: z.string().trim().max(1000).optional(), overdueReason: z.string().trim().max(1000).optional(), purposeReason: z.string().trim().max(1000).optional() });

/** Annahme 5: die Prüfungen des Einreichens. */
/** Annahme 5(a): kein am Zahlungstag gültiger Bescheid, oder er ging erst danach ein — nur bei `taxExemptBody`. */
export function noticeReasonNeeded(deps: Deps, partner: FinancePartnerProfileRow, paymentDate: string): boolean {
  if (partner.status !== 'taxExemptBody') return false;
  const notice = partnerNoticeValidAtInternal(deps.db, partner.id, paymentDate);
  return !notice || notice.receivedOn > paymentDate;
}

/** Annahme 5(b): bei diesem Partner ist der Nachweis eines *anderen* Vorgangs schon über die Kulanzfrist hinaus überfällig. */
export function overdueReasonNeeded(deps: Deps, partner: FinancePartnerProfileRow, excludePaymentId: string): boolean {
  const graceDays = readSetting<number>(deps, 'finance.proofGraceDays');
  const due = partnerProofDeadlinesInternal(deps.db, todayIn(deps), graceDays);
  return due.some((d) => d.partnerId === partner.id && d.paymentId !== excludePaymentId && d.overdue);
}

/** Annahme 5: Zahlungstag zum Prüfzeitpunkt — bei `retroactive` das Datum der ältesten Paid-Line, sonst heute (Vorschau; die Freigabe kennt den echten Tag). */
export function checkDateFor(deps: Deps, payment: Pick<FinancePartnerPaymentRow, 'retroactive'>, paidLines: readonly PaidLineView[]): string {
  if (!payment.retroactive) return todayIn(deps);
  return [...paidLines].sort((a, b) => a.entryDate.localeCompare(b.entryDate))[0]?.entryDate ?? todayIn(deps);
}

function submitProblem(deps: Deps, partner: FinancePartnerProfileRow, payment: FinancePartnerPaymentRow, positions: readonly PositionView[], paidLines: readonly PaidLineView[], v: { noticeReason?: string; overdueReason?: string; purposeReason?: string }): Result<null> {
  if (payment.purposeText.trim() === '') return invalid([{ path: 'purposeText', message: 'required' }]);
  if (payment.basisOverridden && !payment.basisOverrideReason) return financeConflict('partnerBasisOverrideNeedsReason');
  if (payment.retroactive) {
    if (paidLines.length === 0) return financeConflict('paidLinesRequired');
    if (paidLines.some((l) => !l.final)) return financeConflict('paidLineNotFinal');
  } else if (positions.length === 0) return financeConflict('expenseNothingToSubmit');
  if (payment.basis === 'agent57' && (!payment.agreementDocumentId || payment.agreementDocumentId === partner.agreementDocumentId)) return invalid([{ path: 'agreementDocumentId', message: 'ownAgreementRequired' }]);
  if (payment.basis === 'transfer58' && partner.status === 'foreignBody' && !payment.agreementDocumentId) return invalid([{ path: 'agreementDocumentId', message: 'required' }]);
  const issues: ValidationIssue[] = [];
  positions.forEach((p, i) => { if (p.kind === 'money' && !p.categoryId) issues.push({ path: `positions.${i}.categoryId`, message: 'required' }); });
  if (issues.length > 0) return invalid(issues);
  const paymentDate = checkDateFor(deps, payment, paidLines);
  if (noticeReasonNeeded(deps, partner, paymentDate) && !v.noticeReason) return financeConflict('partnerNoticeReasonRequired');
  if (overdueReasonNeeded(deps, partner, payment.id) && !v.overdueReason) return financeConflict('partnerOverdueReasonRequired');
  if (!payment.retroactive) {
    const purposeProblem = purposeNegativeProblemInternal(deps.db, { reason: v.purposeReason, lines: purposeOutflowsOf(positions) });
    if (purposeProblem) return purposeProblem;
  }
  return ok(null);
}

/**
 * Einreichen (Annahme 5): bei `retroactive` entstehen die Geldpositionen aus
 * den gewählten Zeilen — der Zahlungstag ist das Datum der ältesten. Sonst
 * bleibt `proofDueOn` offen bis zur Freigabe (Task 4), die den Zahlungstag erst kennt.
 */
export async function submitPartnerPayment(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PartnerPaymentView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, submitSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const payment = deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, v.id)).get();
  if (!payment) return notFound('financePartnerPayment', v.id);
  if (payment.state !== 'draft') return financeConflict('partnerPaymentNotSubmitted');
  const stale = staleVersion(v.expectedVersion, payment.updatedAt);
  if (stale) return stale;
  const partner = partnerOf(deps.db, payment.partnerId)!;
  const positions = positionViewsOf(deps.db, payment.id);
  const paidLines = paidLineViewsOf(deps.db, payment.id);
  const problem = submitProblem(deps, partner, payment, positions, paidLines, v);
  if (!problem.ok) return problem;

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    // Entscheidung 2: die Frist gilt ab dem Einreichen fest — eine spätere Änderung am Partner wirkt nicht mehr.
    const proofMonths = payment.proofMonths ?? partner.usualProofMonths;
    if (payment.retroactive) {
      // N (Prüfer Block 2): je bezahlter Zeile eine Geldposition mit Kategorie, Zweck und Projekt der gebuchten Zeile.
      paidLines.forEach((l, i) => {
        const source = tx.select({ categoryId: financeAllocationLines.categoryId, purposeId: financeAllocationLines.purposeId, projectId: financeAllocationLines.projectId }).from(financeAllocationLines).where(eq(financeAllocationLines.id, l.paidLineId)).get();
        tx.insert(financePartnerPaymentPositions).values({ id: newId(), paymentId: payment.id, sortOrder: positions.length + i, kind: 'money', amountCents: l.amountCents, categoryId: source?.categoryId ?? null, purposeId: source?.purposeId ?? null, projectId: source?.projectId ?? null, goodsLineId: null, note: null }).run();
      });
    }
    const changed = tx
      .update(financePartnerPayments)
      .set({ state: 'submitted', submittedAt: now, proofMonths, noticeReason: v.noticeReason ?? null, overdueReason: v.overdueReason ?? null, purposeNegativeReason: !payment.retroactive && v.purposeReason && purposeGoingNegative(deps.db, purposeOutflowsOf(positions)) ? v.purposeReason : null, updatedAt: nextVersion(deps, payment.updatedAt) })
      .where(and(eq(financePartnerPayments.id, payment.id), eq(financePartnerPayments.state, 'draft')))
      .run().changes;
    if (changed !== 1) return financeConflict('partnerPaymentNotSubmitted');
    const after = tx.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, payment.id)).get()!;
    const finalPositions = positionViewsOf(tx, payment.id);
    // Spec 14.4: Verlangt die Art eine Vereinbarung (Förderung im Ausland) oder den Auftrag je Vorhaben, ist das Dokument des Entwurfs dieser Nachweis — einmal, nie doppelt.
    const required = requiredEvidenceKindsFor(partner, after, finalPositions);
    if (after.agreementDocumentId && required.includes('agreement')) {
      const present = tx.select().from(financePartnerEvidence).where(eq(financePartnerEvidence.paymentId, payment.id)).all().some((e) => e.documentId === after.agreementDocumentId && (e.kind === 'agreement' || e.kind === 'assignment'));
      if (!present) {
        const evidenceId = newId();
        tx.insert(financePartnerEvidence).values({ id: evidenceId, paymentId: payment.id, kind: 'agreement', documentId: after.agreementDocumentId, foreignLanguage: false, explanationDe: null, coveredCents: null, addedByUserId: ctx.userId ?? 'system', addedAt: now }).run();
        financeAudit(tx, deps, ctx, { action: 'finance.partnerEvidence.add', entity: 'financePartnerEvidence', id: evidenceId, after: { paymentId: payment.id, kind: 'agreement', foreignLanguage: false, coveredCents: null, documentId: after.agreementDocumentId }, summary: `Nachweis ${evidenceId} an Zahlung an Partner ${payment.id} aus dem Entwurf übernommen` });
      }
    }
    financeAudit(tx, deps, ctx, {
      action: 'finance.partnerPayment.submit', entity: 'financePartnerPayment', id: payment.id,
      before: { state: 'draft' }, after: { state: 'submitted', basis: after.basis, basisOverridden: after.basisOverridden, retroactive: after.retroactive, positionCount: finalPositions.length, totalCents: sumPositionCents(finalPositions), proofMonths: after.proofMonths, proofDueOn: after.proofDueOn, submittedAt: now, channel: ctx.channel },
      summary: `Zahlung an Partner (Entwurf) ${payment.id} eingereicht`,
    });
    return ok(toView(deps, ctx, tx, after));
  });
}

// ── Ablehnen ────────────────────────────────────────────────────────────────

export const idSchema = z.object({ id: z.string().min(1) });
export const rejectSchema = z.object({ id: z.string().min(1), note: z.string().trim().min(1).max(1000) });

/** `finance.approve`, nicht humanOnly (Annahme 8): der Grund steht am Vorgang, im Protokoll nicht. */
export async function rejectPartnerPayment(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PartnerPaymentView>> {
  const denied = requirePermission(ctx, 'finance.approve');
  if (denied) return denied;
  const parsed = validate(deps, rejectSchema, input);
  if (!parsed.ok) return parsed;
  const payment = deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, parsed.value.id)).get();
  if (!payment) return notFound('financePartnerPayment', parsed.value.id);
  if (payment.state !== 'submitted') return financeConflict('partnerPaymentNotSubmitted');
  return deps.db.transaction((tx: DbOrTx) => {
    const changed = tx
      .update(financePartnerPayments)
      .set({ state: 'rejected', rejectedAt: isoNow(deps.clock), rejectedByUserId: ctx.userId ?? 'system', rejectNote: parsed.value.note, updatedAt: nextVersion(deps, payment.updatedAt) })
      .where(and(eq(financePartnerPayments.id, payment.id), eq(financePartnerPayments.state, 'submitted')))
      .run().changes;
    if (changed !== 1) return financeConflict('partnerPaymentNotSubmitted');
    const after = tx.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, payment.id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.partnerPayment.reject', entity: 'financePartnerPayment', id: payment.id, before: { state: 'submitted' }, after: { state: 'rejected', channel: ctx.channel }, summary: `Zahlung an Partner ${payment.id} abgelehnt` });
    return ok(toView(deps, ctx, tx, after));
  });
}

// ── Kopie, Entwurf löschen ───────────────────────────────────────────────────

/** `finance.entriesWrite` (Annahme 8): nur von einem abgelehnten Vorgang — Positionen kopiert, Paid-Lines nur, wenn noch frei; Nachweise neu verknüpft. */
export async function copyPartnerPayment(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PartnerPaymentView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const source = deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, parsed.value.id)).get();
  if (!source) return notFound('financePartnerPayment', parsed.value.id);
  if (source.state !== 'rejected') return financeConflict('partnerPaymentNotRejected');

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const id = newId();
    tx.insert(financePartnerPayments).values({
      id, partnerId: source.partnerId, basis: source.basis, basisOverridden: source.basisOverridden, basisOverrideReason: source.basisOverrideReason,
      purposeText: source.purposeText, agreementDocumentId: source.agreementDocumentId, retroactive: source.retroactive, proofMonths: source.proofMonths, state: 'draft',
      copiedFromPaymentId: source.id, createdByUserId: ctx.userId ?? 'system', createdAt: now, updatedAt: now,
    }).run();
    if (source.agreementDocumentId) linkDocumentInternal(tx, deps, { documentId: source.agreementDocumentId, entityType: 'financePartnerPayment', entityId: id });

    for (const p of positionsOf(tx, source.id)) {
      if (source.retroactive && p.kind === 'money') continue; // entsteht neu aus den Paid-Lines beim Einreichen
      tx.insert(financePartnerPaymentPositions).values({ ...p, id: newId(), paymentId: id }).run();
    }
    // Annahme 8: „Paid-Lines nur, wenn noch frei“ — eine Zeile des abgelehnten Vorgangs gehörte bis hierher nur ihm
    // selbst; sie wandert auf den neuen Entwurf (Update, kein Löschen: der Trigger sperrt nur Insert/Delete nach dem
    // Einreichen). Trägt eine Zeile inzwischen ein anderer, aktiver Vorgang, bleibt sie dort.
    for (const pl of paidLinesOf(tx, source.id)) {
      tx.update(financePartnerPaidLines).set({ paymentId: id }).where(eq(financePartnerPaidLines.id, pl.id)).run();
    }
    for (const e of deps.db.select().from(financePartnerEvidence).where(eq(financePartnerEvidence.paymentId, source.id)).all()) {
      tx.insert(financePartnerEvidence).values({ ...e, id: newId(), paymentId: id, addedByUserId: ctx.userId ?? 'system', addedAt: now }).run();
      if (e.documentId) linkDocumentInternal(tx, deps, { documentId: e.documentId, entityType: 'financePartnerPayment', entityId: id });
    }
    financeAudit(tx, deps, ctx, { action: 'finance.partnerPayment.copy', entity: 'financePartnerPayment', id, after: { state: 'draft', basis: source.basis, retroactive: source.retroactive, copiedFromPaymentId: source.id }, summary: `Zahlung an Partner ${source.number ?? source.id} als Entwurf ${id} neu angelegt` });
    return ok(toView(deps, ctx, tx, tx.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, id)).get()!));
  });
}

/** Löschregel `financePartnerPaymentDraft` (Annahme 15): nur `draft`. */
export async function deletePartnerPaymentDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const payment = deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, parsed.value.id)).get();
  if (!payment) return notFound('financePartnerPayment', parsed.value.id);
  if (payment.state !== 'draft') return financeConflict('partnerPaymentNotSubmitted');
  return deps.db.transaction((tx: DbOrTx) => {
    const positionCount = tx.delete(financePartnerPaymentPositions).where(eq(financePartnerPaymentPositions.paymentId, payment.id)).run().changes;
    tx.delete(financePartnerPaidLines).where(eq(financePartnerPaidLines.paymentId, payment.id)).run();
    tx.delete(financePartnerEvidence).where(eq(financePartnerEvidence.paymentId, payment.id)).run();
    tx.delete(documentLinks).where(and(eq(documentLinks.entityType, 'financePartnerPayment'), eq(documentLinks.entityId, payment.id))).run();
    tx.delete(financePartnerPayments).where(eq(financePartnerPayments.id, payment.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.partnerPayment.draftDelete', entity: 'financePartnerPayment', id: payment.id, before: { state: payment.state, positionCount }, summary: `Zahlung an Partner (Entwurf) ${payment.id} gelöscht` });
    return ok({ id: payment.id });
  });
}

// ── Lesen ───────────────────────────────────────────────────────────────────

/** `finance.read`. */
export async function getPartnerPayment(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PartnerPaymentView>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, parsed.value.id)).get();
  if (!row) return notFound('financePartnerPayment', parsed.value.id);
  return ok(toView(deps, ctx, deps.db, row));
}

export const listSchema = z.object({ partnerId: z.string().min(1).optional() });

/** `finance.read`: jüngste zuerst. */
export async function listPartnerPayments(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PartnerPaymentView[]>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(financePartnerPayments).where(parsed.value.partnerId ? eq(financePartnerPayments.partnerId, parsed.value.partnerId) : undefined).orderBy(desc(financePartnerPayments.createdAt)).all();
  return ok(rows.map((row) => toView(deps, ctx, deps.db, row)));
}

/**
 * `finance.read`: die Fristen — Annahme 13, für das Werkzeug `finance_partner_proof_deadlines`.
 * U (Prüfer Block 2): `readyToAcknowledge` sagt je Zahlung, ob der Aufrufer ihre Nachweise jetzt anerkennen
 * könnte — nur mit „Freigeben“, nie die eigene Zahlung.
 */
export async function partnerProofDeadlines(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<(ReturnType<typeof partnerProofDeadlinesInternal>[number] & { readyToAcknowledge: boolean })[]>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, z.object({}), input ?? {});
  if (!parsed.ok) return parsed;
  const graceDays = readSetting<number>(deps, 'finance.proofGraceDays');
  const ready = new Set(hasPermission(ctx, 'finance.approve') ? paymentsReadyToAcknowledgeInternal(deps.db, ctx.userId ?? null).map((r) => r.id) : []);
  return ok(partnerProofDeadlinesInternal(deps.db, todayIn(deps), graceDays).map((d) => ({ ...d, readyToAcknowledge: ready.has(d.paymentId) })));
}

/** Annahme 9: ob ein Dokument an mehr als einem Vorgang als Nachweis hängt. */
export function evidenceUsedMultipleTimesInternal(db: DbOrTx, documentId: string): boolean {
  const rows = db.select({ paymentId: financePartnerEvidence.paymentId }).from(financePartnerEvidence).where(eq(financePartnerEvidence.documentId, documentId)).all();
  return new Set(rows.map((r) => r.paymentId)).size > 1;
}

export { paymentProofSatisfied };
