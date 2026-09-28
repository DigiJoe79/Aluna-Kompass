/**
 * Datumsformat für Texte, die ein Mensch liest (Befund 27a) — `ledger/`
 * bindet sich damit nicht an `typst-pure.ts` (dort liegt derselbe Helfer für
 * die Dokument-Vorlagen). Rein, ohne Import.
 */

/** ISO → TT.MM.JJJJ. */
export function germanDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}
