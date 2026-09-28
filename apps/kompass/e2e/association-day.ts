/**
 * „Heute“ in den E2E-Tests (W3): der Kalendertag in der Zeitzone des Vereins, wie `todayIn`/`yearIn` im Kern —
 * nie der UTC-Tag. Zwischen 00:00 und 02:00 MESZ lag der UTC-Tag noch beim gestrigen, der Server aber schon beim
 * heutigen; zwei Tests waren dann rot (Nachtlauf 2026-09-28). Die Testinstanzen tragen keine eigene Zeitzone,
 * also gilt die Vorgabe des Kerns (`DEFAULT_TIME_ZONE`, `tests/utc-days.test.ts` hält beide gleich). Rein, ohne
 * Import aus dem Kern, damit der Playwright-Lauf nicht die Datenbankschicht lädt.
 */
export const ASSOCIATION_TIME_ZONE = 'Europe/Berlin';

function isoDayIn(zone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Der Vereinstag von `now`, um `offsetDays` Kalendertage verschoben (`YYYY-MM-DD`). */
export function associationDay(offsetDays = 0, now: Date = new Date()): string {
  const day = new Date(`${isoDayIn(ASSOCIATION_TIME_ZONE, now)}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return isoDayIn('UTC', day); // Kalenderrechnung auf dem Tag selbst, kein Zeitpunkt beteiligt
}

/** Das laufende Jahr des Vereins. */
export function associationYear(now: Date = new Date()): number {
  return Number(associationDay(0, now).slice(0, 4));
}
