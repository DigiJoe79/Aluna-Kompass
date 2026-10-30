import { isoDayInZone } from '@kompass/core/dates';

/**
 * „Jetzt“ im Mitlauf (Plan U1, Global Constraints): die eine Stelle, an der der Browser die Uhr liest; ein Test ersetzt
 * `nowIso`. Die Uhrzeit `HH:MM` in der Vereinszone kommt aus `useDateFormat().time`.
 */
export const liveClock = { nowIso: (): string => new Date().toISOString() };

/**
 * Die Uhrzeit, mit der der Mitlauf rechnet. Anwesenheit und Abstimmungen kennen nur Uhrzeiten des Sitzungstags; ist der
 * Sitzungstag in der Vereinszone vorbei (Sitzung über Mitternacht, später geöffneter Mitlauf), gilt sein Ende — sonst
 * läge „00:30“ vor jedem Kommen und niemand wäre mehr anwesend.
 */
export function liveTimeOn(nowIso: string, heldOn: string, timeZone: string, time: (iso: string) => string): string {
  return isoDayInZone(new Date(nowIso), timeZone) > heldOn ? '23:59' : time(nowIso);
}
