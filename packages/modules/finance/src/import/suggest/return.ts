/**
 * Zurückgegebene Zahlung (F5, Spec 6.4 Vorschlag 2; Annahme 7): nur, wenn die
 * Bank einen Rückgabe-Code liefert (CAMT). Rein — Wächter `suggest-purity.test.ts`.
 */
import { daysApart, type RawLike } from './pair';

/** Wie weit eine Rückgabe höchstens hinter der ursprünglichen Zahlung liegt. */
export const RETURN_WINDOW_DAYS = 60;

const compactIban = (iban: string): string => iban.replace(/\s+/g, '').toUpperCase();

/**
 * Die gebuchte Zahlung, die ein Umsatz mit Rückgabe-Code zurückgibt: gleiche
 * IBAN, Betrag genau negiert, nicht später und höchstens 60 Tage früher. Bei
 * mehreren die jüngste.
 */
export function findReturnOrigin<T extends RawLike>(target: RawLike & { returnCode: string | null }, booked: readonly T[]): T | null {
  if (!target.returnCode || !target.counterpartyIban) return null;
  const iban = compactIban(target.counterpartyIban);
  let best: T | null = null;
  for (const b of booked) {
    if (!b.counterpartyIban || compactIban(b.counterpartyIban) !== iban) continue;
    if (b.amountCents !== -target.amountCents) continue;
    if (b.bookingDate > target.bookingDate || daysApart(b.bookingDate, target.bookingDate) > RETURN_WINDOW_DAYS) continue;
    if (!best || b.bookingDate > best.bookingDate) best = b;
  }
  return best;
}
