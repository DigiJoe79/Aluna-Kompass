import { compactIban } from '../format/iban';

/** Gespeichert und verglichen wird ohne Leerräume, groß — `compactIban` (MUSTER § IBAN). */
export const normalizeIban = compactIban;

/** Anzeige: eine Stelle (`format/iban.ts`, Stufe 1, Auftrag 4) — Vierergruppen bzw. `DE ·· 3000`. */
export { formatIban, maskIban } from '../format/iban';

/** ISO 13616: Länderkennung, zwei Prüfziffern, bis zu 30 Zeichen; umgestellt und als Zahl gelesen ergibt es mod 97 den Rest 1. */
export function isValidIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const digits = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

