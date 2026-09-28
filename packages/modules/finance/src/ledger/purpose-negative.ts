import type { DbOrTx, Failure } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { financeConflict } from '../errors';
import { financePurposes } from '../schema';
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
