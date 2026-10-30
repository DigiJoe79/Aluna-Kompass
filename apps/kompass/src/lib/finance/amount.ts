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

export type AmountError = 'missing' | 'format';
export type AmountRead = { ok: true; cents: number | null } | { ok: false; error: AmountError };

/**
 * Betrag aus einem Eingabefeld lesen, mit Feldfehler statt stillem Rückfall (Code-Review 0.4.0, App-B6/B7): leer und
 * optional ist „kein Betrag“ (`cents: null`), leer und Pflicht `missing`, unlesbar immer `format` — nie still `null`
 * oder 0. Die Fehler heißen wie die Schlüssel unter `finance.amount` in der Sprachdatei. Wächter
 * `patterns/no-silent-amount.test.ts`.
 */
export function readAmount(text: string, opts: { required: boolean }): AmountRead {
  if (text.trim().length === 0) return opts.required ? { ok: false, error: 'missing' } : { ok: true, cents: null };
  const cents = parseAmount(text);
  return cents === null ? { ok: false, error: 'format' } : { ok: true, cents };
}

/** Mehrere Betragsfelder einer Maske mit `readAmount`: alle Werte, oder je unlesbarem/fehlendem Feld der Fehler. */
export function readAmounts<K extends string>(fields: Record<K, { text: string; required: boolean }>): { ok: true; cents: Record<K, number | null> } | { ok: false; errors: Partial<Record<K, AmountError>> } {
  const cents = {} as Record<K, number | null>;
  const errors: Partial<Record<K, AmountError>> = {};
  for (const key of Object.keys(fields) as K[]) {
    const read = readAmount(fields[key].text, { required: fields[key].required });
    if (read.ok) cents[key] = read.cents;
    else errors[key] = read.error;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, cents };
}

/** Schreiben: `@kompass/module-finance/format` (MUSTER § Beträge) — eine Stelle für App und Finanzmodul. */
export { formatAmount, formatEuro, type AmountFormatOptions } from '@kompass/module-finance/format';
