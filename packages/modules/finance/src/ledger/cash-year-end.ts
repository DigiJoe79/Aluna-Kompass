import type { DbOrTx } from '@kompass/core';
import { and, desc, eq, gt, lt } from 'drizzle-orm';
import { financeAccounts, financeCashCounts, financeEntries, financeMoneyLines, type FinanceFiscalYearRow } from '../schema';
import { accountBalancesAt } from './queries';

/** Tage auf einen Kalendertag, ohne Zeitzone. */
function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** Eine Kassenbewegung (festgeschriebene Geldzeile) nach `after` und vor `before`. */
function cashMovedBetween(db: DbOrTx, accountId: string, after: string, before: string): boolean {
  return !!db
    .select({ id: financeMoneyLines.id })
    .from(financeMoneyLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeMoneyLines.entryId))
    .where(and(eq(financeMoneyLines.accountId, accountId), eq(financeEntries.status, 'final'), gt(financeEntries.entryDate, after), lt(financeEntries.entryDate, before)))
    .get();
}

export interface CashAtYearEnd {
  accountId: string;
  name: string;
  count: { countId: string; countedOn: string; countedCents: number; differenceCents: number } | null;
  /** Ohne gültige Zählung: die erste Zählung nach dem Stichtag, dazu der Buchbestand am Stichtag (Rückrechnung). */
  later: { countId: string; countedOn: string; countedCents: number; differenceCents: number; bookCentsAtEnd: number } | null;
}

/**
 * Je Kasse des Jahres die Zählung am Stichtag — oder die erste danach, wenn dazwischen nichts bewegt wurde (Claude).
 * Ist dazwischen gebucht, steht die erste spätere Zählung als `later` da; ohne Differenz lässt sich der Bestand zum
 * Stichtag aus ihr rückrechnen (Schritt 2 des Jahresabschlusses, Board 14a). Im Ledger, weil auch die Bestätigung je
 * Konto (`confirmAccountForYear`, `cashRecomputed`) es braucht — `ledger/` kennt `closing/` nicht.
 */
export function cashAtYearEndInternal(db: DbOrTx, year: FinanceFiscalYearRow): CashAtYearEnd[] {
  const cashAccounts = db
    .select()
    .from(financeAccounts)
    .where(eq(financeAccounts.kind, 'cash'))
    .all()
    // Eine Kasse, die erst nach dem Stichtag eröffnet wurde, zählt nicht (Schlussdurchsicht I1).
    .filter((a) => (a.isActive && (a.openingDate === null || a.openingDate <= year.endsOn)) || cashMovedBetween(db, a.id, addDays(year.startsOn, -1), addDays(year.endsOn, 1)))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const bookAtEnd = cashAccounts.length > 0 ? new Map(accountBalancesAt(db, year.endsOn).map((b) => [b.accountId, b.balanceCents])) : new Map<string, number>();
  return cashAccounts.map((a) => {
    const atEnd = db.select().from(financeCashCounts).where(and(eq(financeCashCounts.accountId, a.id), eq(financeCashCounts.countedOn, year.endsOn))).orderBy(desc(financeCashCounts.createdAt)).get();
    const after = atEnd ?? db.select().from(financeCashCounts).where(and(eq(financeCashCounts.accountId, a.id), gt(financeCashCounts.countedOn, year.endsOn))).orderBy(financeCashCounts.countedOn, financeCashCounts.createdAt).get();
    const count = after && (after.countedOn === year.endsOn || !cashMovedBetween(db, a.id, year.endsOn, after.countedOn)) ? after : null;
    const later = !count && after ? { countId: after.id, countedOn: after.countedOn, countedCents: after.countedCents, differenceCents: after.differenceCents, bookCentsAtEnd: bookAtEnd.get(a.id) ?? 0 } : null;
    return { accountId: a.id, name: a.name, count: count ? { countId: count.id, countedOn: count.countedOn, countedCents: count.countedCents, differenceCents: count.differenceCents } : null, later };
  });
}
