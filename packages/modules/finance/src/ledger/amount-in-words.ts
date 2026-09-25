/**
 * Betrag in Buchstaben für das amtliche Muster der Zuwendungsbestätigung
 * („Betrag der Zuwendung – in Buchstaben –“). Rein: kein Import, keine Uhr.
 * Die Zahlwörter sind deutsch, weil das Muster es ist (Ausnahme von Prinzip 7).
 *
 * Bis 999.999.999,99 €; darüber, negativ oder nicht ganzzahlig ist ein
 * Programmfehler des Aufrufers und wirft `RangeError`.
 */

const ONES = ['', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
const TEENS = ['zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

export const AMOUNT_IN_WORDS_MAX_CENTS = 99_999_999_999;

/** 0–99; `final` hängt an eine allein stehende Eins das „s“ („hunderteins“), vor „tausend“ oder „Euro“ nicht. */
function belowHundred(n: number, final: boolean): string {
  if (n === 0) return '';
  if (n === 1) return final ? 'eins' : 'ein';
  if (n < 10) return ONES[n]!;
  if (n < 20) return TEENS[n - 10]!;
  const unit = n % 10;
  const tens = TENS[Math.floor(n / 10)]!;
  return unit === 0 ? tens : `${ONES[unit]}und${tens}`;
}

/** 0–999. */
function belowThousand(n: number, final: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return `${hundreds > 0 ? `${ONES[hundreds]}hundert` : ''}${belowHundred(rest, final)}`;
}

/** Ganze Zahl bis 999.999.999 in Worten; `final` wie oben, für die letzte Stelle vor der Einheit. */
function integerInWords(n: number, final: boolean): string {
  if (n === 0) return 'null';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions > 0) parts.push(millions === 1 ? 'eine Million' : `${belowThousand(millions, false)} Millionen`);
  const tail = `${thousands > 0 ? `${belowThousand(thousands, false)}tausend` : ''}${belowThousand(rest, final)}`;
  if (tail !== '') parts.push(tail);
  return parts.join(' ');
}

/** Wie `integerInWords`, aber eine Eins allein vor der Einheit heißt „ein“ („ein Euro“, „ein Cent“). */
function unitAmount(n: number): string {
  return n === 1 ? 'ein' : integerInWords(n, true);
}

export function amountInWords(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0 || cents > AMOUNT_IN_WORDS_MAX_CENTS) {
    throw new RangeError(`amountInWords: ${cents} is not a whole number of cents between 0 and ${AMOUNT_IN_WORDS_MAX_CENTS}`);
  }
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  if (euros === 0 && rest > 0) return `${unitAmount(rest)} Cent`;
  const euroPart = `${unitAmount(euros)} Euro`;
  return rest === 0 ? euroPart : `${euroPart} und ${unitAmount(rest)} Cent`;
}
