/**
 * Bankarbeitstage nach dem TARGET2-Kalender (Spec Mitglieder und Lastschrift § 7.1): geschlossen an Samstag, Sonntag,
 * 1. Januar, Karfreitag, Ostermontag, 1. Mai, 25. und 26. Dezember. Rein, ohne Uhr und Datenbank; Tage als ISO-Text.
 * Regionale Feiertage zählen nicht — für den Einzug gilt der Kalender des Zahlungssystems.
 */

import { easterSunday } from '../ledger/working-days';

const pad = (n: number) => String(n).padStart(2, '0');

function toUtc(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Ein Tag plus `n` Kalendertage (`n` darf negativ sein). */
export function addCalendarDays(day: string, n: number): string {
  const date = toUtc(day);
  date.setUTCDate(date.getUTCDate() + n);
  return fromUtc(date);
}

/** Ein Tag plus `n` Monate; fehlt der Tag im Zielmonat (31.), gilt dessen letzter. */
export function addCalendarMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`;
}

export { easterSunday };

/** Ist der Tag ein Bankarbeitstag im TARGET2-Kalender? */
export function isTargetBusinessDay(day: string): boolean {
  const weekday = toUtc(day).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const monthDay = day.slice(5);
  if (monthDay === '01-01' || monthDay === '05-01' || monthDay === '12-25' || monthDay === '12-26') return false;
  const easter = easterSunday(Number(day.slice(0, 4)));
  return day !== addCalendarDays(easter, -2) && day !== addCalendarDays(easter, 1);
}

/** Der `n`-te Bankarbeitstag nach (`n` > 0) bzw. vor (`n` < 0) dem Tag; `n = 0` gibt den Tag selbst zurück. */
export function addBusinessDays(day: string, n: number): string {
  const step = n < 0 ? -1 : 1;
  let current = day;
  for (let left = Math.abs(n); left > 0; ) {
    current = addCalendarDays(current, step);
    if (isTargetBusinessDay(current)) left -= 1;
  }
  return current;
}
