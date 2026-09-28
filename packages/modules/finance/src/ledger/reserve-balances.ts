import type { DbOrTx } from '@kompass/core';
import { and, eq, lte } from 'drizzle-orm';
import { financeReserveMovements, financeReserves, type FinanceReserveMovementRow, type FinanceReserveRow } from '../schema';

/**
 * Bestand des zurückgelegten Geldes (F8b Annahme 3) — rein: Vortrag (ab
 * seinem Stichtag) + Σ `allocate` − Σ `withdraw` − Σ `dissolve`, bis
 * `date` (beide eingeschlossen). `ledger/` importiert nichts (`direction.test.ts`).
 */
export function reserveBalanceAt(reserve: Pick<FinanceReserveRow, 'carryForwardCents' | 'carryForwardDate'>, movements: readonly Pick<FinanceReserveMovementRow, 'kind' | 'movementDate' | 'amountCents'>[], date: string): number {
  const carryForwardCents = reserve.carryForwardCents !== null && reserve.carryForwardDate !== null && reserve.carryForwardDate <= date ? reserve.carryForwardCents : 0;
  let balance = carryForwardCents;
  for (const m of movements) {
    if (m.movementDate > date) continue;
    if (m.kind === 'allocate') balance += m.amountCents;
    else balance -= m.amountCents;
  }
  return balance;
}

export interface ReserveBalance {
  reserveId: string;
  balanceCents: number;
}

/** Abfrage über `schema.ts` — jedes zurückgelegte Geld, auch ohne je einen Vorgang gesehen zu haben. */
export function reserveBalancesAt(db: DbOrTx, date: string): ReserveBalance[] {
  const reserves = db.select().from(financeReserves).all();
  return reserves.map((reserve) => {
    const movements = db.select().from(financeReserveMovements).where(and(eq(financeReserveMovements.reserveId, reserve.id), lte(financeReserveMovements.movementDate, date))).all();
    return { reserveId: reserve.id, balanceCents: reserveBalanceAt(reserve, movements, date) };
  });
}

/** Der bisher jüngste Vorgang je zurückgelegtem Geld — für die Datumsreihenfolge (`reserveMovementOutOfOrder`). */
export function latestMovementDate(db: DbOrTx, reserveId: string): string | null {
  const rows = db.select({ movementDate: financeReserveMovements.movementDate }).from(financeReserveMovements).where(eq(financeReserveMovements.reserveId, reserveId)).all();
  return rows.reduce<string | null>((max, r) => (max === null || r.movementDate > max ? r.movementDate : max), null);
}

/** Ob dieses zurückgelegte Geld schon aufgelöst ist (Annahme 2: nach `dissolve` keine weiteren Vorgänge). */
export function reserveIsDissolved(db: DbOrTx, reserveId: string): boolean {
  return !!db.select({ id: financeReserveMovements.id }).from(financeReserveMovements).where(and(eq(financeReserveMovements.reserveId, reserveId), eq(financeReserveMovements.kind, 'dissolve'))).get();
}
