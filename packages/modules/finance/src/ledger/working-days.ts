/**
 * Werktage für Steuerfristen (Spec E6 Teil 4, Teil 6). Rein, ohne Uhr und Datenbank; Tage als ISO-Text.
 *
 * § 108 Abs. 3 AO (gesetze-im-internet.de, abgerufen 2026-10-25): „Fällt das Ende einer Frist auf einen Sonntag, einen
 * gesetzlichen Feiertag oder einen Sonnabend, so endet die Frist mit dem Ablauf des nächstfolgenden Werktags.“
 *
 * Gesetzliche Feiertage sind Landesrecht (Feiertagsgesetze der Länder); bundesweit gilt nur der 3. Oktober kraft
 * Einigungsvertrag (Art. 2 Abs. 2). Abgebildet sind nur landesweite Tage, keine Gemeindefeiertage (Fronleichnam in Teilen
 * von SN/TH, Mariä Himmelfahrt in Teilen von BY, Augsburger Friedensfest). Sonntagsfeiertage (Oster-, Pfingstsonntag)
 * fehlen, weil der Sonntag ohnehin kein Werktag ist. Einführungsjahre nachgelesen am 2026-10-25: Frauentag BE seit 2019,
 * MV seit 2023 (4. ÄndG FTG M-V, Beschluss 28.06.2022); Weltkindertag TH seit 2019 (3. ÄndG ThürFtG, Drs. 6/6163);
 * Reformationstag HB, HH, NI, SH seit 2018; 31.10.2017 einmalig in allen Ländern (500 Jahre Reformation); Tag der
 * Befreiung 08.05. in BE einmalig 2020 und 2025.
 */

export const FEDERAL_STATES = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'] as const;
export type FederalState = (typeof FEDERAL_STATES)[number];

const pad = (n: number) => String(n).padStart(2, '0');

function toUtc(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function plusDays(day: string, n: number): string {
  const date = toUtc(day);
  date.setUTCDate(date.getUTCDate() + n);
  return fromUtc(date);
}

/** Ostersonntag des Jahres (gregorianisch, anonymer Algorithmus nach Gauß/Meeus). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(dayOfMonth)}`;
}

/** Ein Feiertag: fester Tag (`MM-DD`), Abstand zu Ostern oder eigene Regel; ohne `states` in allen Ländern. */
type HolidayRule = { states?: readonly FederalState[]; fromYear?: number; onlyYear?: number } & ({ monthDay: string } | { easterOffset: number } | { rule: 'repentanceDay' });

const ALL_NORTH_2018: readonly FederalState[] = ['HB', 'HH', 'NI', 'SH'];

const HOLIDAYS: readonly HolidayRule[] = [
  { monthDay: '01-01' }, // Neujahr
  { easterOffset: -2 }, // Karfreitag
  { easterOffset: 1 }, // Ostermontag
  { monthDay: '05-01' }, // Tag der Arbeit
  { easterOffset: 39 }, // Christi Himmelfahrt
  { easterOffset: 50 }, // Pfingstmontag
  { monthDay: '10-03', fromYear: 1990 }, // Tag der Deutschen Einheit
  { monthDay: '12-25' },
  { monthDay: '12-26' },
  { monthDay: '10-31', onlyYear: 2017 }, // Reformationsjubiläum, einmalig in allen Ländern
  { monthDay: '01-06', states: ['BW', 'BY', 'ST'] }, // Heilige Drei Könige
  { monthDay: '03-08', states: ['BE'], fromYear: 2019 }, // Internationaler Frauentag
  { monthDay: '03-08', states: ['MV'], fromYear: 2023 },
  { monthDay: '05-08', states: ['BE'], onlyYear: 2020 }, // Tag der Befreiung, einmalig
  { monthDay: '05-08', states: ['BE'], onlyYear: 2025 },
  { easterOffset: 60, states: ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'] }, // Fronleichnam
  { monthDay: '08-15', states: ['SL'] }, // Mariä Himmelfahrt
  { monthDay: '09-20', states: ['TH'], fromYear: 2019 }, // Weltkindertag
  { monthDay: '10-31', states: ['BB', 'MV', 'SN', 'ST', 'TH'] }, // Reformationstag
  { monthDay: '10-31', states: ALL_NORTH_2018, fromYear: 2018 },
  { monthDay: '11-01', states: ['BW', 'BY', 'NW', 'RP', 'SL'] }, // Allerheiligen
  { rule: 'repentanceDay', states: ['SN'] }, // Buß- und Bettag: Mittwoch vor dem 23. November
];

/** Der Mittwoch vor dem 23. November (zwischen 16. und 22.). */
function repentanceDay(year: number): string {
  const nov22 = toUtc(`${year}-11-22`);
  const back = (nov22.getUTCDay() - 3 + 7) % 7;
  return plusDays(`${year}-11-22`, -back);
}

/** Die gesetzlichen Feiertage des Jahres, sortiert, ohne Doppel; ohne Land nur die in allen Ländern. */
export function publicHolidays(year: number, state?: FederalState | null): string[] {
  const easter = easterSunday(year);
  const days = new Set<string>();
  for (const h of HOLIDAYS) {
    if (h.states && (!state || !h.states.includes(state))) continue;
    if (h.fromYear !== undefined && year < h.fromYear) continue;
    if (h.onlyYear !== undefined && year !== h.onlyYear) continue;
    if ('monthDay' in h) days.add(`${year}-${h.monthDay}`);
    else if ('easterOffset' in h) days.add(plusDays(easter, h.easterOffset));
    else days.add(repentanceDay(year));
  }
  return [...days].sort();
}

/** Der Tag selbst, wenn er Mo–Fr und kein Feiertag ist; sonst der nächste solche Tag (§ 108 Abs. 3 AO). */
export function nextWorkingDay(date: string, state?: FederalState | null): string {
  let day = date;
  for (;;) {
    const weekday = toUtc(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !publicHolidays(Number(day.slice(0, 4)), state).includes(day)) return day;
    day = plusDays(day, 1);
  }
}
