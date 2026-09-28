/**
 * Der Dublettenschlüssel eines Kontoumsatzes — rein, ohne Datenbank (Spec
 * 6.3). `ordinal` ist die laufende Nummer unter sonst gleichen Zeilen
 * desselben Auszugs (zwei gleiche Lastschriften am selben Tag sind zwei
 * Zahlungen, keine Dublette) und wird vom Aufrufer gezählt.
 */

/**
 * Kleinbuchstaben, jeder Leerraum entfernt (nicht nur zusammengefasst),
 * deutsche Umlaute gefaltet (ä→ae, ö→oe, ü→ue, ß→ss), dann die ersten 40
 * Zeichen — zwei Verwendungszwecke, die sich erst danach unterscheiden,
 * gelten als derselbe (Spec 6.3).
 */
export function normalizePurpose(text: string): string {
  const folded = text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, '');
  return folded.slice(0, 40);
}

export function dedupKey(line: { bookingDate: string; amountCents: number; counterpartyIban: string | null; purpose: string }, ordinal: number): string {
  return [line.bookingDate, String(line.amountCents), line.counterpartyIban ?? '', normalizePurpose(line.purpose), String(ordinal)].join('|');
}
