import { channelKey, type ChannelKey } from '@/lib/finance/channel';

/**
 * Die Schloss-Zeile als Satz (HANDOFF § 2.5; Runde 3, 089): Datum, Uhrzeit, Person und Weg der Festschreibung. Sie
 * steht als Unterzeile unter der Nummer im Seitenkopf — die Marke „festgeschrieben“ daneben sagt den Zustand, ein
 * zweiter Kasten mit Schloss darunter wiederholte ihn. Den Kanal entscheidet `channelKey`, nie die Anzeige: Ein Seed-
 * oder Hintergrundlauf erscheint nie still als „Oberfläche“ (F3a-N Task 3).
 */
export function lockLineText(
  t: (key: 'text' | 'unknownUser', values?: Record<string, string>) => string,
  tc: (key: ChannelKey) => string,
  event: { at: string; userName: string | null; channel: string | null },
  fmt: { date: (iso: string) => string; time: (iso: string) => string },
): string {
  return t('text', { date: fmt.date(event.at), time: fmt.time(event.at), name: event.userName ?? t('unknownUser'), channel: tc(channelKey(event.channel)) });
}
