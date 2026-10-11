/**
 * Betrag lesen und schreiben, deutsches Format (Finanz-Spec 5.4, HANDOFF § 2.1).
 * Der Punkt ist immer Tausendertrenner, nie Dezimalpunkt — ein Betrag wie
 * `12.50` ist deshalb ein Formatfehler, nicht 12,50.
 */
const AMOUNT_PATTERN = /^([-−]?)(?:(\d{1,3}(?:\.\d{3})+)|(\d+))(?:,(\d{1,2}))?$/;

/** '12,50' → 1250; '1.234,56' → 123456; '12' → 1200; '−15,00'/'-15' → -1500. Alles andere: `null`. */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const match = AMOUNT_PATTERN.exec(trimmed);
  if (!match) return null;
  const [, sign, grouped, plain, fracRaw] = match;
  const integerDigits = (grouped ?? plain ?? '').replace(/\./g, '');
  const fracDigits = fracRaw === undefined ? '00' : fracRaw.length === 1 ? `${fracRaw}0` : fracRaw;
  const cents = Number(integerDigits) * 100 + Number(fracDigits);
  return sign ? -cents : cents;
}

/** Schreiben: `@kompass/module-finance/format` (MUSTER § Beträge) — eine Stelle für App und Finanzmodul. */
export { formatAmount, formatEuro, type AmountFormatOptions } from '@kompass/module-finance/format';
