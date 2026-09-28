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

/** Weiche Trennstelle (U+00AD) — nur für `amountInWordsHyphenated`; unsichtbar, solange nicht am Zeilenende. */
const SHY = '­';

export const AMOUNT_IN_WORDS_MAX_CENTS = 99_999_999_999;

/** Zwei Wortteile an einer Zahlwortgrenze verbunden — `sep` nur zwischen zwei nicht leeren Teilen. */
const join = (a: string, b: string, sep: string) => (a && b ? `${a}${sep}${b}` : `${a}${b}`);

/** 0–99; `final` hängt an eine allein stehende Eins das „s“ („hunderteins“), vor „tausend“ oder „Euro“ nicht. `sep` (Vorgabe leer) steht an den Zahlwortgrenzen — für `amountInWordsHyphenated`. */
function belowHundred(n: number, final: boolean, sep = ''): string {
  if (n === 0) return '';
  if (n === 1) return final ? 'eins' : 'ein';
  if (n < 10) return ONES[n]!;
  if (n < 20) return TEENS[n - 10]!;
  const unit = n % 10;
  const tens = TENS[Math.floor(n / 10)]!;
  return unit === 0 ? tens : `${ONES[unit]}${sep}und${sep}${tens}`;
}

/** 0–999. */
function belowThousand(n: number, final: boolean, sep = ''): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const hundredPart = hundreds > 0 ? `${ONES[hundreds]}${sep}hundert` : '';
  return join(hundredPart, belowHundred(rest, final, sep), sep);
}

/** Ganze Zahl bis 999.999.999 in Worten; `final` wie oben, für die letzte Stelle vor der Einheit. */
function integerInWords(n: number, final: boolean, sep = ''): string {
  if (n === 0) return 'null';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions > 0) parts.push(millions === 1 ? 'eine Million' : `${belowThousand(millions, false, sep)} Millionen`);
  const thousandPart = thousands > 0 ? `${belowThousand(thousands, false, sep)}${sep}tausend` : '';
  const tail = join(thousandPart, belowThousand(rest, final, sep), sep);
  if (tail !== '') parts.push(tail);
  return parts.join(' ');
}

/** Wie `integerInWords`, aber eine Eins allein vor der Einheit heißt „ein“ („ein Euro“, „ein Cent“). */
function unitAmount(n: number, sep = ''): string {
  return n === 1 ? 'ein' : integerInWords(n, true, sep);
}

/** Gemeinsamer Bau für `amountInWords` und `amountInWordsHyphenated` — `sep` steht an den Zahlwortgrenzen, sonst leer. */
function wordsOf(cents: number, sep: string): string {
  if (!Number.isInteger(cents) || cents < 0 || cents > AMOUNT_IN_WORDS_MAX_CENTS) {
    throw new RangeError(`amountInWords: ${cents} is not a whole number of cents between 0 and ${AMOUNT_IN_WORDS_MAX_CENTS}`);
  }
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  if (euros === 0 && rest > 0) return `${unitAmount(rest, sep)} Cent`;
  const euroPart = `${unitAmount(euros, sep)} Euro`;
  return rest === 0 ? euroPart : `${euroPart} und ${unitAmount(rest, sep)} Cent`;
}

export function amountInWords(cents: number): string {
  return wordsOf(cents, '');
}

/**
 * Wie `amountInWords`, aber mit weichen Trennstellen (U+00AD) an den
 * Zahlwortgrenzen („zwei­tausend­sieben­hundert­sechzig“) — für die Tabellenzelle
 * „in Buchstaben“ des amtlichen Musters, die sonst ein einziges, nicht
 * trennbares Wort über die Zellgrenze schreibt. Ohne die Trennstellen
 * identisch mit `amountInWords`.
 */
export function amountInWordsHyphenated(cents: number): string {
  return wordsOf(cents, SHY);
}
