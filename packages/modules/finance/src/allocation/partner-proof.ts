import type { DbOrTx } from '@kompass/core';
import { and, eq, isNull } from 'drizzle-orm';
import { openCentsInternal, openItemSettlementsInternal } from '../ledger/open-items';
import { DEFAULT_PROOF_MONTHS, financeAllocationLines, financeEntries, financePartnerEvidence, financePartnerPaidLines, financePartnerPaymentPositions, financePartnerPayments, financePartnerProfiles, type FinancePartnerPaidLineRow, type FinancePartnerPaymentPositionRow, type FinancePartnerPaymentRow } from '../schema';
import { coverageRequired, evidenceCoverage, missingEvidence, proofDueDate, requiredEvidenceKinds } from './evidence-rules';

/**
 * Zahlungstag, Schritt und Nachweisfrist einer Zahlung an Partner — ohne
 * Rechteprüfung, nur Datenbank. Eigene Datei, damit `partners.ts` (Liste E1)
 * und `partner-payments.ts` dieselbe Rechnung nutzen, ohne sich gegenseitig
 * zu importieren.
 */

export function positionsOf(db: DbOrTx, paymentId: string): FinancePartnerPaymentPositionRow[] {
  return db.select().from(financePartnerPaymentPositions).where(eq(financePartnerPaymentPositions.paymentId, paymentId)).orderBy(financePartnerPaymentPositions.sortOrder).all();
}

/** Betrag und Kategorie einer Sachposition kommen aus der Einkaufszeile, werden nie kopiert (Annahme 4). */
export function goodsLineInfo(db: DbOrTx, lineId: string): { amountCents: number; categoryId: string } | null {
  const line = db.select().from(financeAllocationLines).where(eq(financeAllocationLines.id, lineId)).get();
  return line ? { amountCents: Math.abs(line.amountCents), categoryId: line.categoryId } : null;
}

export interface PositionView {
  id: string;
  kind: 'money' | 'goods';
  amountCents: number;
  categoryId: string | null;
  purposeId: string | null;
  projectId: string | null;
  goodsLineId: string | null;
  note: string | null;
}

export function positionViewsOf(db: DbOrTx, paymentId: string): PositionView[] {
  return positionsOf(db, paymentId).map((p) => {
    const goods = p.kind === 'goods' && p.goodsLineId ? goodsLineInfo(db, p.goodsLineId) : null;
    return { id: p.id, kind: p.kind, amountCents: goods ? goods.amountCents : (p.amountCents ?? 0), categoryId: goods ? goods.categoryId : p.categoryId, purposeId: p.purposeId, projectId: p.projectId, goodsLineId: p.goodsLineId, note: p.note };
  });
}

export const sumPositionCents = (positions: readonly PositionView[]) => positions.reduce((s, p) => s + p.amountCents, 0);

export function paidLinesOf(db: DbOrTx, paymentId: string): FinancePartnerPaidLineRow[] {
  return db.select().from(financePartnerPaidLines).where(eq(financePartnerPaidLines.paymentId, paymentId)).all();
}

export interface PaidLineView {
  id: string;
  paidLineId: string;
  entryDate: string;
  amountCents: number;
  /** Festgeschrieben — erst dann lässt sich die Zahlung einreichen (Task 5, Arbeitsliste). */
  final: boolean;
}

export function paidLineViewsOf(db: DbOrTx, paymentId: string): PaidLineView[] {
  return paidLinesOf(db, paymentId).map((pl) => {
    const line = db.select({ amountCents: financeAllocationLines.amountCents, entryId: financeAllocationLines.entryId }).from(financeAllocationLines).where(eq(financeAllocationLines.id, pl.paidLineId)).get();
    const entry = line ? db.select({ entryDate: financeEntries.entryDate, status: financeEntries.status }).from(financeEntries).where(eq(financeEntries.id, line.entryId)).get() : undefined;
    return { id: pl.id, paidLineId: pl.paidLineId, entryDate: entry?.entryDate ?? '', amountCents: Math.abs(line?.amountCents ?? 0), final: entry?.status === 'final' };
  });
}

export type ActiveStep = 'draft' | 'submitted' | 'approved' | 'paid' | 'acknowledged';

/** Annahme 19: genau ein aktiver Schritt — `null` für einen abgelehnten Vorgang (kein Fortschrittsschlüssel). */
export function activeStepOf(db: DbOrTx, payment: FinancePartnerPaymentRow): ActiveStep | null {
  if (payment.state === 'rejected') return null;
  if (payment.state === 'draft') return 'draft';
  if (payment.state === 'submitted') return 'submitted'; // O (Prüfer Block 2): wartet auf Freigabe
  if (payment.acknowledgedAt) return 'acknowledged';
  const paid = payment.retroactive || (payment.openItemId !== null && openCentsInternal(db, payment.openItemId) <= 0);
  return paid ? 'paid' : 'approved';
}

/** Tag der Zahlung: bei nachträglicher Freigabe die älteste bezahlte Zeile, sonst der Tag, an dem der Posten beglichen war. */
export function paidOnOf(db: DbOrTx, row: FinancePartnerPaymentRow): string | null {
  const step = activeStepOf(db, row);
  if (step !== 'paid' && step !== 'acknowledged') return null;
  if (row.retroactive) return [...paidLineViewsOf(db, row.id)].sort((a, b) => a.entryDate.localeCompare(b.entryDate))[0]?.entryDate ?? null;
  if (!row.openItemId) return null;
  return openItemSettlementsInternal(db, row.openItemId).map((s) => s.entryDate).sort().at(-1) ?? null;
}

/** Tage auf ein ISO-Datum — wie in `allocation/approvals.ts`. */
export function addDaysInternal(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Die Nachweisfrist (Joe 28.09., Task 6c): n Monate ab dem **Zahlungstag** —
 * vorher gibt es kein Datum und kein „überfällig“. Berechnet, nie gespeichert
 * (Prinzip 5); eine früher bei der Freigabe gespeicherte `proof_due_on` wird
 * nicht mehr gelesen. Die Monate stehen ab dem Einreichen fest an der Zahlung,
 * davor gilt die übliche Frist des Partners.
 */
export function proofDueOnOf(db: DbOrTx, row: FinancePartnerPaymentRow, usualProofMonths?: number): string | null {
  const paidOn = paidOnOf(db, row);
  if (!paidOn) return null;
  const months = row.proofMonths ?? usualProofMonths ?? db.select({ m: financePartnerProfiles.usualProofMonths }).from(financePartnerProfiles).where(eq(financePartnerProfiles.id, row.partnerId)).get()?.m ?? DEFAULT_PROOF_MONTHS;
  return proofDueDate(paidOn, months);
}

/** Annahme 13: Vorgänge, freigegeben und gezahlt, aber noch nicht anerkannt — mit Frist ab Zahlung, für Kachel, Liste und Kulanzfrist. */
export function partnerProofDeadlinesInternal(db: DbOrTx, todayIso: string, graceDays: number): { paymentId: string; partnerId: string; proofDueOn: string; overdue: boolean }[] {
  const rows = db.select().from(financePartnerPayments).where(and(eq(financePartnerPayments.state, 'approved'), isNull(financePartnerPayments.acknowledgedAt))).all();
  return rows.flatMap((r) => {
    const proofDueOn = proofDueOnOf(db, r);
    return proofDueOn ? [{ paymentId: r.id, partnerId: r.partnerId, proofDueOn, overdue: addDaysInternal(proofDueOn, graceDays) < todayIso }] : [];
  });
}

/** E1 (Design-Nachtrag Phase 4): offene und überfällige Nachweise und der letzte Zahlungstag eines Partners. */
export function partnerProofStatsInternal(db: DbOrTx, partnerId: string, todayIso: string, graceDays: number): { openProofCount: number; overdueProofCount: number; lastPaidOn: string | null } {
  const due = partnerProofDeadlinesInternal(db, todayIso, graceDays).filter((d) => d.partnerId === partnerId);
  const approved = db.select().from(financePartnerPayments).where(and(eq(financePartnerPayments.partnerId, partnerId), eq(financePartnerPayments.state, 'approved'))).all();
  const lastPaidOn = approved.map((r) => paidOnOf(db, r)).filter((d): d is string => d !== null).sort().at(-1) ?? null;
  return { openProofCount: approved.filter((r) => r.acknowledgedAt === null).length, overdueProofCount: due.filter((d) => d.overdue).length, lastPaidOn };
}

/** Tage zwischen zwei ISO-Daten (b − a). */
function daysBetweenInternal(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000);
}

export interface OpenProofView {
  paymentId: string;
  partnerId: string;
  number: string | null;
  proofDueOn: string | null;
  overdue: boolean;
  /** Seit wie vielen Tagen die Frist verstrichen ist; `null`, solange sie läuft oder es noch keine gibt. */
  overdueDays: number | null;
}

/** Kachel „Zahlungen an Partner ohne Nachweis“ (Entscheidung 8): jede freigegebene, noch nicht anerkannte Zahlung, mit Frist und Verzug. */
export function openProofsInternal(db: DbOrTx, todayIso: string, graceDays: number): OpenProofView[] {
  const due = new Map(partnerProofDeadlinesInternal(db, todayIso, graceDays).map((d) => [d.paymentId, d] as const));
  const rows = db.select().from(financePartnerPayments).where(and(eq(financePartnerPayments.state, 'approved'), isNull(financePartnerPayments.acknowledgedAt))).all();
  return rows
    .map((r) => {
      const d = due.get(r.id);
      const overdue = d?.overdue ?? false;
      return { paymentId: r.id, partnerId: r.partnerId, number: r.number, proofDueOn: d?.proofDueOn ?? null, overdue, overdueDays: overdue && d ? daysBetweenInternal(d.proofDueOn, todayIso) : null };
    })
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.proofDueOn ?? '9999').localeCompare(b.proofDueOn ?? '9999'));
}

/**
 * U (Prüfer Block 2, Task 6c): Die Nachweise liegen bereit zum Anerkennen —
 * freigegeben, gezahlt, alle Pflichtarten mit echtem Dokument, jede
 * fremdsprachige erläutert, die Deckung (nur beim Auftrag) vollständig. Wer
 * sie anerkennen darf, prüft der Aufrufer (Recht „Freigeben“, nie die eigene).
 */
export function readyToAcknowledgeInternal(db: DbOrTx, row: FinancePartnerPaymentRow): boolean {
  if (row.state !== 'approved' || row.acknowledgedAt !== null || activeStepOf(db, row) !== 'paid') return false;
  const status = db.select({ status: financePartnerProfiles.status }).from(financePartnerProfiles).where(eq(financePartnerProfiles.id, row.partnerId)).get()?.status;
  if (!status) return false;
  const positions = positionViewsOf(db, row.id);
  const required = requiredEvidenceKinds({ basis: row.basis, partnerStatus: status, hasGoodsPositions: positions.some((p) => p.kind === 'goods') });
  const evidence = db.select().from(financePartnerEvidence).where(eq(financePartnerEvidence.paymentId, row.id)).all();
  const missing = missingEvidence(required, evidence);
  if (missing.missingKinds.length + missing.missingExplanation.length + missing.missingAmount.length > 0) return false;
  return !coverageRequired(required) || evidenceCoverage(evidence, sumPositionCents(positions)).complete;
}

/**
 * Könnte **diese Person** die Nachweise jetzt anerkennen — bereit, nie die
 * eigene Zahlung. Das Recht „Freigeben“ prüft der Aufrufer
 * (`readyToAcknowledgeFor` in `partner-payments.ts`); eine Quelle für Kachel,
 * Fristen, Zahlung und Liste (U Rest, Recheck sha-0170e73).
 */
export function readyForUserInternal(db: DbOrTx, row: FinancePartnerPaymentRow, userId: string | null): boolean {
  return row.createdByUserId !== userId && readyToAcknowledgeInternal(db, row);
}

/** Die Zahlungen, deren Nachweise diese Person anerkennen könnte — nie die eigenen. */
export function paymentsReadyToAcknowledgeInternal(db: DbOrTx, userId: string | null): FinancePartnerPaymentRow[] {
  return db
    .select()
    .from(financePartnerPayments)
    .where(and(eq(financePartnerPayments.state, 'approved'), isNull(financePartnerPayments.acknowledgedAt)))
    .all()
    .filter((r) => readyForUserInternal(db, r, userId));
}
