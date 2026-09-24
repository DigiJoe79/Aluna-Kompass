/**
 * Paar-Erkennung eigener Konten und Bar-Kennung (F5, Spec 6.4 Vorschlag 1).
 * Rein, ohne Datenbank und ohne Import aus `@kompass/*` oder `../`
 * (Wächter `suggest-purity.test.ts`).
 */
import { normalizeText } from './rule';

/** Was die Vorschlagsfunktionen von einem Kontoumsatz brauchen. */
export interface RawLike {
  id: string;
  accountId: string;
  bookingDate: string;
  amountCents: number;
  counterpartyIban: string | null;
}

/** Ganze Tage zwischen zwei Daten `YYYY-MM-DD`, ohne Vorzeichen. */
export function daysApart(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(`${a}T00:00:00.000Z`) - Date.parse(`${b}T00:00:00.000Z`)) / 86_400_000));
}

/**
 * Der Gegen-Umsatz einer Umbuchung zwischen eigenen Konten: anderes Konto,
 * entgegengesetztes Vorzeichen, höchstens `matchDays` Tage auseinander, und
 * der Betrag weicht höchstens um die Gebührentoleranz ab — und zwar nur so,
 * dass unterwegs etwas fehlt (`feeCents` = was nicht angekommen ist; mehr
 * angekommen als abgegangen ist keine Gebühr). Bei mehreren gewinnt die
 * kleinste Abweichung, dann das nächste Datum. Der Aufrufer gibt nur offene
 * Umsätze herein.
 */
export function findPair<T extends RawLike>(target: RawLike, others: readonly T[], opts: { matchDays: number; feeToleranceCents: number }): { other: T; feeCents: number } | null {
  let best: { other: T; feeCents: number; days: number } | null = null;
  for (const other of others) {
    if (other.id === target.id || other.accountId === target.accountId) continue;
    if (Math.sign(other.amountCents) === Math.sign(target.amountCents)) continue;
    const days = daysApart(other.bookingDate, target.bookingDate);
    if (days > opts.matchDays) continue;
    const sum = other.amountCents + target.amountCents;
    if (sum > 0 || -sum > opts.feeToleranceCents) continue;
    const feeCents = sum === 0 ? 0 : -sum;
    if (!best || feeCents < best.feeCents || (feeCents === best.feeCents && days < best.days)) best = { other, feeCents, days };
  }
  return best ? { other: best.other, feeCents: best.feeCents } : null;
}

/** Steht eines der Stichwörter (`finance.cashKeywords`) im Verwendungszweck? Vergleich wie `normalizeText`. */
export function isCashKeyword(purpose: string, keywords: readonly string[]): boolean {
  const text = normalizeText(purpose);
  return keywords.some((k) => {
    const key = normalizeText(k);
    return key.length > 0 && text.includes(key);
  });
}
