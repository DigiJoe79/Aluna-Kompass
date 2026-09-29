import type { DbOrTx, Failure } from '@kompass/core';
import { eq, inArray } from 'drizzle-orm';
import { financeConflict } from '../errors';
import { financeExpenseClaims, financeMoneyLines, financeOpenItems, financeOpenItemSettlements, financePartnerPayments, financePurposes } from '../schema';
import { purposeBalancesAt } from './queries';

/** Weit genug in der Zukunft, dass jede festgeschriebene Zeile und jeder Vortrag zählt. */
const ALL_DAYS = '9999-12-31';

/**
 * Befund Q (Block 2, Teil C Task 2c): Machen diese Beträge je Zweck den Bestand
 * eines Zwecks negativ (oder noch negativer), braucht es eine Begründung — kein
 * Verbot, Muster AH. Gemessen am Bestand über alle festgeschriebenen Zeilen und
 * freigegebenen Umwidmungen plus diese Beträge. Ergebnis: der Konflikt für den
 * ersten betroffenen Zweck oder `null`.
 */
export function purposeNegativeProblemInternal(db: DbOrTx, input: { reason: string | null | undefined; lines: readonly { purposeId?: string | null; amountCents: number }[] }): Failure | null {
  if (input.reason?.trim()) return null;
  return purposeGoingNegative(db, input.lines);
}

/** Ob die Beträge einen Zweck ins Minus bringen — ohne Blick auf eine Begründung (für „Begründung gebraucht?“). */
export function purposeGoingNegative(db: DbOrTx, lines: readonly { purposeId?: string | null; amountCents: number }[]): Failure | null {
  const delta = new Map<string, number>();
  for (const line of lines) if (line.purposeId) delta.set(line.purposeId, (delta.get(line.purposeId) ?? 0) + line.amountCents);
  const lowering = [...delta].filter(([, cents]) => cents < 0);
  if (lowering.length === 0) return null;
  const balances = new Map(purposeBalancesAt(db, ALL_DAYS).map((b) => [b.purposeId, b.balanceCents]));
  for (const [purposeId, cents] of lowering) {
    const after = (balances.get(purposeId) ?? 0) + cents;
    if (after >= 0) continue;
    const name = db.select({ name: financePurposes.name }).from(financePurposes).where(eq(financePurposes.id, purposeId)).get()?.name ?? '';
    return financeConflict('purposeGoesNegative', { purpose: name, balance: after });
  }
  return null;
}

/**
 * Befund 1: Läuft die Buchung über den Posten eines Antrags (Auslage oder Zahlung an Partner), gilt die Begründung „Zweck im
 * Minus“, die bei dessen Freigabe gegeben wurde — sie wird nicht ein zweites Mal verlangt. Nur Posten dieser beiden Herkünfte
 * zählen; eine beliebige andere Buchung auf denselben Zweck bleibt begründungspflichtig.
 */
export function inheritedPurposeReasonOfOpenItemsInternal(db: DbOrTx, openItemIds: readonly string[]): string | null {
  if (openItemIds.length === 0) return null;
  const items = db.select({ originType: financeOpenItems.originType, originId: financeOpenItems.originId }).from(financeOpenItems).where(inArray(financeOpenItems.id, [...openItemIds])).all();
  for (const item of items) {
    if (!item.originId) continue;
    const reason =
      item.originType === 'financeExpenseClaim'
        ? db.select({ reason: financeExpenseClaims.purposeNegativeReason }).from(financeExpenseClaims).where(eq(financeExpenseClaims.id, item.originId)).get()?.reason
        : item.originType === 'financePartnerPayment'
          ? db.select({ reason: financePartnerPayments.purposeNegativeReason }).from(financePartnerPayments).where(eq(financePartnerPayments.id, item.originId)).get()?.reason
          : null;
    if (reason?.trim()) return reason.trim();
  }
  return null;
}

/** Wie `inheritedPurposeReasonOfOpenItemsInternal`, für einen gespeicherten Entwurf: die Posten, die seine Geldzeilen ausgleichen. */
export function inheritedPurposeReasonOfEntryInternal(db: DbOrTx, entryId: string): string | null {
  const moneyLineIds = db.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(eq(financeMoneyLines.entryId, entryId)).all().map((r) => r.id);
  if (moneyLineIds.length === 0) return null;
  const openItemIds = db.select({ id: financeOpenItemSettlements.openItemId }).from(financeOpenItemSettlements).where(inArray(financeOpenItemSettlements.moneyLineId, moneyLineIds)).all().map((r) => r.id);
  return inheritedPurposeReasonOfOpenItemsInternal(db, openItemIds);
}
