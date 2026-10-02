'use client';

const startsWith = (name: string, buffer: string) =>
  name.slice(0, buffer.length).localeCompare(buffer, 'de', { sensitivity: 'base' }) === 0;

/**
 * Sprung-Suche im Baum (APG Tree View, „Type-ahead“): der nächste sichtbare
 * Ordner, dessen Name mit dem Getippten beginnt — ohne Rücksicht auf Groß-
 * schreibung und Umlaute („ä“ findet „Ämter“, „a“ auch). Ein wiederholter
 * Buchstabe („vv“) springt zum nächsten Treffer weiter; ein längerer Puffer
 * („ve“) bleibt auf dem aktuellen, solange er noch passt.
 */
export function nextTypeAheadMatch(names: readonly { id: string; name: string }[], fromIndex: number, buffer: string): string | null {
  if (!buffer || names.length === 0) return null;
  const chars = [...buffer];
  const repeated = chars.every((c) => c.localeCompare(chars[0]!, 'de', { sensitivity: 'base' }) === 0);
  const needle = repeated ? chars[0]! : buffer;
  // Einzelner oder wiederholter Buchstabe: ab der nächsten Zeile; sonst ab der aktuellen.
  const start = repeated ? fromIndex + 1 : Math.max(fromIndex, 0);
  for (let step = 0; step < names.length; step++) {
    const entry = names[(start + step) % names.length]!;
    if (startsWith(entry.name, needle)) return entry.id;
  }
  return null;
}

/** Wie lange Tastendrücke zu einem Suchwort zusammenlaufen. */
export const TYPE_AHEAD_MS = 500;
