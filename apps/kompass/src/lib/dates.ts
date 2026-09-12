/**
 * Ein Datum sieht überall gleich aus (Befund 8, 2026-09-12): Listen zeigten
 * ISO, Notizen deutsch. Das Format ist eine Einstellung (`ui.dateFormat`,
 * Prinzip 2): „aus der Sprache“ — bei Deutsch 12.09.2026 — oder ISO 8601.
 * Gespeichert und verglichen wird weiterhin ISO; formatiert wird nur, was ein
 * Mensch liest.
 */
export type DateFormatMode = 'locale' | 'iso';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Ein ISO-Datum (`2026-09-12`) oder ein ISO-Zeitstempel als Datum. */
export function formatDate(value: string | null | undefined, mode: DateFormatMode, locale = 'de-DE'): string {
  if (!value) return '';
  const day = value.slice(0, 10);
  if (mode === 'iso' || !DATE_ONLY.test(day)) return day;
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  );
}

/** Ein ISO-Zeitstempel als Datum mit Uhrzeit, in der Zeitzone des Vereins. */
export function formatDateTime(value: string | null | undefined, mode: DateFormatMode, locale = 'de-DE', timeZone = 'Europe/Berlin'): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (mode === 'iso') {
    const parts = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  }
  return new Intl.DateTimeFormat(locale, { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
