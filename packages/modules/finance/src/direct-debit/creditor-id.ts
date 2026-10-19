/**
 * Gläubiger-Identifikationsnummer (Spec § 7.1): `CCpp` + Geschäftsbereichskennung (3 Zeichen) + nationale Kennung.
 * Die Prüfziffer `pp` rechnet wie bei der IBAN (ISO 7064 MOD 97-10), aber über `nationale Kennung + Land + "00"` —
 * **ohne** die Geschäftsbereichskennung, die der Verein frei wählen darf. Rein.
 */

const FORMAT = /^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/;

/** Ohne Leerräume, groß — so wird gespeichert und verglichen. */
export function normalizeCreditorId(id: string): string {
  return id.replace(/\s+/g, '').toUpperCase();
}

/** Ziffernfolge mit A = 10 … Z = 35, Rest modulo 97 stückweise (kein BigInt nötig). */
function mod97(text: string): number {
  const digits = [...text].map((ch) => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch)).join('');
  let rest = 0;
  for (const digit of digits) rest = (rest * 10 + Number(digit)) % 97;
  return rest;
}

export function isValidCreditorId(id: string): boolean {
  const plain = normalizeCreditorId(id);
  if (!FORMAT.test(plain)) return false;
  const country = plain.slice(0, 2);
  const check = Number(plain.slice(2, 4));
  const national = plain.slice(7);
  return 98 - mod97(`${national}${country}00`) === check;
}
