/**
 * Prüfergebnis fürs Feld (H2, Befund A5: kein Bankname aus der IBAN — nur
 * das Prüfergebnis). Die Prüfziffernrechnung steht hier noch einmal klein für
 * den Client; sie muss auf denselben Testvektoren übereinstimmen wie
 * `isValidIban` im Modul (`packages/modules/finance/src/ledger/iban.ts`).
 *
 * Nur die vier Zustände der Oberfläche: leer, gültig, Prüfziffer falsch,
 * Länge passt nicht zum Land. Ein Format, das gar nicht wie eine IBAN aussieht
 * (keine zwei Buchstaben vorn, Sonderzeichen), zählt als „Länge passt nicht“ —
 * ein eigener fünfter Zustand lohnte für ein Feld nicht.
 */

const normalize = (text: string): string => text.replace(/\s+/g, '').toUpperCase();

/** Erwartete Gesamtlänge je Land (ISO 13616); die in Europa gebräuchlichen. */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20,
  ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27,
  LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25,
  RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
};

function checksumOk(iban: string): boolean {
  const digits = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

export interface IbanCheckResult {
  state: 'empty' | 'valid' | 'checksum' | 'length';
  country: string | null;
}

export function checkIban(text: string): IbanCheckResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { state: 'empty', country: null };
  const iban = normalize(trimmed);
  const format = /^([A-Z]{2})\d{2}[A-Z0-9]*$/.exec(iban);
  const country = format ? format[1]! : null;
  const expectedLength = country ? IBAN_LENGTHS[country] : undefined;
  if (!format || expectedLength === undefined || iban.length !== expectedLength) return { state: 'length', country };
  return { state: checksumOk(iban) ? 'valid' : 'checksum', country };
}
