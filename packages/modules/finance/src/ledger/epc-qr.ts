import { isValidIban, normalizeIban } from './iban';

export interface EpcQrInput {
  recipient: string;
  iban: string;
  amountCents: number;
  reference: string;
}

/** EPC069-12 lässt bis zu 999.999.999,99 € zu. */
const MAX_AMOUNT_CENTS = 99999999999;
/** Kapazität des QR-Symbols für Version 40, Fehlerkorrektur M — die Bytegrenze der Nutzlast. */
const MAX_BYTES = 331;
const MAX_RECIPIENT_CHARS = 70;
const MAX_REFERENCE_CHARS = 140;

/** Zeilenumbrüche heraus, dann Leerraum auf ein Leerzeichen zusammenziehen und außen trimmen. */
function cleanText(input: string): string {
  return input
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `EUR12.50` — zwei Nachkommastellen, Punkt statt Komma (EPC069-12). */
function formatAmount(amountCents: number): string {
  return `EUR${(amountCents / 100).toFixed(2)}`;
}

/**
 * Nutzlast des EPC-QR (GiroCode), Version 002, Zeichensatz 1 (UTF-8), SCT
 * (Plan N5 Task 1). Zwölf Zeilen, mit `\n` verbunden: Kennung, Version,
 * Zeichensatz, Identifikationscode, BIC (leer), Empfängername, IBAN, Betrag,
 * Zweckcode (leer), strukturierte Referenz (leer), Verwendungszweck,
 * Beleginformation (leer). `null`, wenn IBAN oder Betrag nicht taugen — der
 * Baustein zeigt dann weiterhin nur den Hinweis ohne QR.
 *
 * Empfängername und Verwendungszweck werden zuerst auf 70 bzw. 140 Zeichen
 * gekürzt; reicht das wegen mehrbytiger UTF-8-Zeichen (Umlaute) nicht, um
 * unter die Bytegrenze von 331 zu kommen, wird der Verwendungszweck
 * zeichenweise weiter gekürzt.
 */
export function epcQrPayload(input: EpcQrInput): string | null {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0 || input.amountCents > MAX_AMOUNT_CENTS) return null;
  if (!isValidIban(input.iban)) return null;

  const iban = normalizeIban(input.iban);
  const recipient = cleanText(input.recipient).slice(0, MAX_RECIPIENT_CHARS);
  let reference = cleanText(input.reference).slice(0, MAX_REFERENCE_CHARS);
  const amount = formatAmount(input.amountCents);

  const build = (): string => ['BCD', '002', '1', 'SCT', '', recipient, iban, amount, '', '', reference, ''].join('\n');

  let payload = build();
  while (Buffer.byteLength(payload, 'utf8') > MAX_BYTES && reference.length > 0) {
    reference = reference.slice(0, -1);
    payload = build();
  }
  return payload;
}
