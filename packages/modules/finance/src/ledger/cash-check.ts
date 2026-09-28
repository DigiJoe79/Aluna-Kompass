import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '@kompass/core';
import { financeEntries, financeMoneyLines, type FinanceAccountRow } from '../schema';

/**
 * Für jedes Barkonto darf kein Tagesendsaldo ab dem Buchungsdatum negativ
 * werden — eine Kasse kann nicht weniger als nichts enthalten, und eine
 * nachgetragene Ausgabe vom 3. kann den Saldo vom 5. ins Minus ziehen
 * (Finanz-Spec 5.4). Nur festgeschriebene Zeilen zählen; im Speicher
 * gerechnet, weil für einen Verein einige tausend Zeilen anfallen — keine
 * Fensterfunktion nötig.
 *
 * @returns der erste Tag ≥ `fromDate`, an dessen Ende das Konto im Minus
 * wäre, mit dem Saldo an diesem Tag — mit `extra` dazugerechnet. `null`: alles
 * gut.
 */
export function firstNegativeCashDay(
  db: DbOrTx,
  account: Pick<FinanceAccountRow, 'id' | 'openingBalanceCents' | 'openingDate'>,
  fromDate: string,
  extra: readonly { date: string; amountCents: number }[],
): { date: string; balanceCents: number } | null {
  const rows = db
    .select({ entryDate: financeEntries.entryDate, amountCents: financeMoneyLines.amountCents })
    .from(financeMoneyLines)
    .innerJoin(financeEntries, eq(financeMoneyLines.entryId, financeEntries.id))
    .where(and(eq(financeMoneyLines.accountId, account.id), eq(financeEntries.status, 'final')))
    .all();

  const byDay = new Map<string, number>();
  for (const row of rows) byDay.set(row.entryDate, (byDay.get(row.entryDate) ?? 0) + row.amountCents);
  for (const line of extra) byDay.set(line.date, (byDay.get(line.date) ?? 0) + line.amountCents);
  if (account.openingBalanceCents !== null && account.openingDate !== null) {
    byDay.set(account.openingDate, (byDay.get(account.openingDate) ?? 0) + account.openingBalanceCents);
  }

  const days = [...byDay.keys()].sort();
  let running = 0;
  for (const day of days) {
    running += byDay.get(day)!;
    if (day >= fromDate && running < 0) return { date: day, balanceCents: running };
  }
  return null;
}

/** „-12,50 €“ — für Fehlermeldungen (Finanz-Spec 5.4). */
export function formatEuro(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  const withThousands = euros.toLocaleString('de-DE');
  return `${sign}${withThousands},${rest} €`;
}
