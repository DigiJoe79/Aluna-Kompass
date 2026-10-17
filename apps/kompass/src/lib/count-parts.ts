/**
 * Zähler und Folgen ohne Nullen (Designer Runde 3: 078, 079, 115, 137; MUSTER § Leerwert): Ein Teil mit der Zahl 0
 * fällt weg — „3 neu · 1 bereits vorhanden“ statt „… · 0 zurückgehalten“. Sind alle null, bleibt der erste Teil,
 * damit die Zeile etwas sagt („0 neu“). Jeder Teil kommt fertig aus der Sprachdatei; hier wird nur gewählt.
 */
export function withoutZeros<T>(parts: ReadonlyArray<readonly [count: number, part: T]>): T[] {
  const kept = parts.filter(([count]) => count !== 0).map(([, part]) => part);
  return kept.length > 0 || parts.length === 0 ? kept : [parts[0]![1]];
}

/**
 * Wie `withoutZeros`, als Text mit „ · “ verbunden. Jeder Teil hält mit geschütztem Leerzeichen zusammen: „1 neu ·
 * 1 zurückgehalten“ bricht nur am „·“, nie zwischen Zahl und Wort (Designer Runde 4 Nachtrag, 214, 217).
 */
export function countParts(parts: ReadonlyArray<readonly [count: number, part: string]>): string {
  return withoutZeros(parts).map((part) => part.replace(/ /g, '\u00a0')).join(' · ');
}
