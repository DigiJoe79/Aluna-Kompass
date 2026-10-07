import { readSetting, timeZoneOf, type Deps } from '@kompass/core';
import { formatDate, formatDateTime, type DateFormatMode } from '@/lib/dates';

/** Was `useDateFormat()` den Client-Bausteinen gibt — hier für Server-Seiten und -Bausteine. */
export type DateFormatter = {
  mode: DateFormatMode;
  timeZone: string;
  date: (value: string | null | undefined) => string;
  dateTime: (value: string | null | undefined) => string;
};

/**
 * Die Anzeige nach `ui.dateFormat` in der Zone des Vereins (`timeZoneOf`) — dieselben beiden Werte, die die
 * Schale dem `DateFormatProvider` gibt. Ein Zeitstempel wird so zum Tag des Vereins, nie zum UTC-Tag.
 */
export function dateFormatOf(deps: Deps): DateFormatter {
  const mode = readSetting<DateFormatMode>(deps, 'ui.dateFormat');
  const timeZone = timeZoneOf(deps);
  return { mode, timeZone, date: (value) => formatDate(value, mode, timeZone), dateTime: (value) => formatDateTime(value, mode, timeZone) };
}
