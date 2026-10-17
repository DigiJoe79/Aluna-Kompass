/**
 * IBAN schreiben — eine Stelle (Durchsicht 0.2.11, Stufe 1, Auftrag 4; MUSTER § IBAN, Wächter `no-raw-iban`).
 * Offen: Vierergruppen mit einfachem Leerzeichen (`DE02 9999 9999 0532 0130 00`): Umbrochen wird nur zwischen den
 * Gruppen, nie in einer (Runde 3, 064 — ein geschütztes Leerzeichen machte die Nummer zu einem Wort, das ein schmales
 * Feld mitten in einer Gruppe brach). Eingefügt in ein Bankformular ist das einfache Leerzeichen auch das gängige. Maskiert: Länderkennung und die letzten vier Zeichen (`DE ·· 3000`), keine Sternchen,
 * keine Punktreihen. Liegt im Finanzmodul, nicht im Kern (Prinzip 1); browsertauglich über
 * `@kompass/module-finance/format`, ohne `@kompass/core`. Prüfziffer und Gültigkeit stehen in `ledger/iban.ts`.
 */
const NBSP = ' ';
const DOTS = '··';

/** Ohne Leerräume, groß: zum Speichern und Vergleichen. */
export function compactIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

/** Zum Lesen: Vierergruppen, getrennt durch U+0020 (Umbruch nur zwischen Gruppen). */
export function formatIban(iban: string): string {
  return compactIban(iban).replace(/(.{4})(?=.)/g, '$1 ');
}

/** Für Listen und Meldungen: `DE ·· 3000`. Eine Nummer, die zu kurz zum Maskieren ist, steht offen. */
export function maskIban(iban: string): string {
  const plain = compactIban(iban);
  if (plain.length <= 6) return formatIban(plain);
  return `${plain.slice(0, 2)}${NBSP}${DOTS}${NBSP}${plain.slice(-4)}`;
}
