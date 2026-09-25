export const normalizeIban = (iban: string): string => iban.replace(/\s+/g, '').toUpperCase();

/** ISO 13616: Länderkennung, zwei Prüfziffern, bis zu 30 Zeichen; umgestellt und als Zahl gelesen ergibt es mod 97 den Rest 1. */
export function isValidIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const digits = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

/** Zum Lesen in Vierergruppen — `DE60 9999 9999 0201 0512 34`. Nur Anzeige; gespeichert wird immer `normalizeIban`. */
export const formatIban = (iban: string): string => normalizeIban(iban).replace(/(.{4})(?=.)/g, '$1 ');

/** Für Listen (F8a): nur die ersten und die letzten vier Zeichen, in Vierergruppen — `DE12 **** **** **** **12 34`. Voll nur im Überweisungsblock. */
export function maskIban(iban: string): string {
  const plain = normalizeIban(iban);
  if (plain.length <= 8) return formatIban(plain);
  return formatIban(`${plain.slice(0, 4)}${'*'.repeat(plain.length - 8)}${plain.slice(-4)}`);
}
