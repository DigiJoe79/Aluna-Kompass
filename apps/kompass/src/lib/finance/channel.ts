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
 * Der Kanal einer Verlaufszeile: Nur „angelegt“ und „festgeschrieben“ tragen
 * einen (Spalten `created_channel`/`finalized_channel`). „geprüft“ ist
 * humanOnly und hat keine Spalte — dort steht nichts, nicht „unbekannt“.
 */
export function historyChannel(event: { kind: string; channel?: string | null }): ChannelKey | null {
  if (event.kind !== 'created' && event.kind !== 'finalized') return null;
  return channelKey(event.channel);
}
