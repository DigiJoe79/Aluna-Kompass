import { DEFAULT_TIME_ZONE, isoDay, isoDayInZone, zonedDayStartIsoInZone } from '@kompass/core';

/**
 * F-B3 (0.4.5): Zeitstempel (`createdAt`, `approvedAt`, `dissolvedAt` …) gehören über die Zeitzone des Vereins zu
 * einem Tag — die ersten zehn Zeichen wären der UTC-Tag, am 01.01. zwischen 00:00 und 01:00 (Sommer 02:00) noch das
 * alte Jahr. Ein Geschäftsjahr muss kein Kalenderjahr sein; seine Grenzen sind die Tage `startsOn` und `endsOn`.
 */
export const TIME_ZONE_SETTING = 'organization.timeZone';

/** Die Zone, mit der ein Bericht rechnet: aus `settingKeys` (`TIME_ZONE_SETTING`), sonst die Vorgabe des Kerns. */
export function reportTimeZone(env?: { settings: Readonly<Record<string, unknown>> }): string {
  return (env?.settings[TIME_ZONE_SETTING] as string | undefined) ?? DEFAULT_TIME_ZONE;
}

/** Der Tag eines Zeitstempels in `timeZone`; ein reiner Tag (`JJJJ-MM-TT`) bleibt, wie er ist. */
export function zonedDayOf(value: string, timeZone: string): string {
  return value.length === 10 ? value : isoDayInZone(new Date(value), timeZone);
}

/** Der Tag nach `day` (`JJJJ-MM-TT`). */
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Die Tage `from` bis `to` (beide eingeschlossen) als Zeitpunkte `[start, end)` in `timeZone` — für `>=`/`<` auf Zeitstempeln. */
export function zonedDayRange(from: string, to: string, timeZone: string): { start: string; end: string } {
  return { start: zonedDayStartIsoInZone(isoDay(from), timeZone), end: zonedDayStartIsoInZone(isoDay(nextDay(to)), timeZone) };
}
