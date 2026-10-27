/**
 * Prüfung der deutschen USt-IdNr. (§ 27a UStG): „DE“ und neun Ziffern, die letzte ist die Prüfziffer nach
 * ISO 7064 MOD 11,10 über die ersten acht. Rein, ohne Datenbank — auch für Formulare.
 */
export function isValidVatId(value: string): boolean {
  const match = /^DE(\d{9})$/.exec(value);
  if (!match) return false;
  const digits = match[1]!;
  let product = 10;
  for (const char of digits.slice(0, 8)) {
    let sum = (Number(char) + product) % 10;
    if (sum === 0) sum = 10;
    product = (2 * sum) % 11;
  }
  const check = (11 - product) % 10;
  return check === Number(digits[8]);
}

/** Eingabe vereinheitlichen: ohne Leerzeichen, in Großbuchstaben. */
export function normalizeVatId(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}
