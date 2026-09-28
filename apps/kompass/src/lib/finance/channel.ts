/**
 * Der wirkliche Weg einer Buchung (Finanz-Spec 5.4/10.5, F3a-N Task 3): die
 * Schloss-Zeile kannte bisher nur `ui`/`mcp` und zeigte einen Kanal `system`
 * (Seed, künftige Hintergrundläufe) fälschlich als „Oberfläche“ an — in der
 * Kassenprüfung eine falsche Aussage. Ein unbekannter oder fehlender Kanal
 * bleibt „unbekannt“, nie still `ui`.
 */
export type ChannelKey = 'ui' | 'mcp' | 'system' | 'unknown';

export function channelKey(channel: string | null | undefined): ChannelKey {
  return channel === 'ui' || channel === 'mcp' || channel === 'system' ? channel : 'unknown';
}

/**
 * Der Kanal einer Verlaufszeile: „angelegt“, „geprüft“ und „festgeschrieben“
 * tragen einen (Spalten `created_channel`/`reviewed_channel`/`finalized_channel`,
 * Befund 18 — mit eingeschaltetem `finance.mcpHumanOnlyAllowed` prüft auch ein
 * Agent). Fehlt er (Zeilen von vor der Spalte), steht „unbekannt“, nie still „ui“.
 */
export function historyChannel(event: { kind: string; channel?: string | null }): ChannelKey | null {
  if (event.kind !== 'created' && event.kind !== 'reviewed' && event.kind !== 'finalized') return null;
  return channelKey(event.channel);
}
