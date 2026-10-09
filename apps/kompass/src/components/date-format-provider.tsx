'use client';

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { DEFAULT_TIME_ZONE, formatDate, formatDateTime, formatStamp, formatTime, type DateFormatMode, type DateTimeOptions } from '@/lib/dates';
import { createDayStore, type DayStore } from '@/lib/day-store';

type DateFormat = { mode: DateFormatMode; timeZone: string; days?: DayStore };

let fallbackDays: DayStore | undefined;
// Ohne Provider (Tests, Seiten außerhalb der Schale) die Vorgabe des Kerns; der Store entsteht erst beim ersten Lesen.
const DateFormatContext = createContext<DateFormat>({ mode: 'locale', timeZone: DEFAULT_TIME_ZONE });

/**
 * Die Schale setzt das Format aus der Einstellung `ui.dateFormat` und die Zone aus `organization.timeZone`
 * (`timeZoneOf`); Client-Bausteine lesen beides hier, Server-Seiten über `dateFormatOf` (`@/lib/date-format`). Aus einem
 * Zeitstempel wird so der Tag des Vereins.
 */
export function DateFormatProvider({ mode, timeZone, children }: { mode: DateFormatMode; timeZone: string; children: ReactNode }) {
  const days = useMemo(() => createDayStore(timeZone), [timeZone]);
  const value = useMemo(() => ({ mode, timeZone, days }), [mode, timeZone, days]);
  return <DateFormatContext.Provider value={value}>{children}</DateFormatContext.Provider>;
}

export function useDateFormat() {
  const { mode, timeZone, days: provided } = useContext(DateFormatContext);
  const days = provided ?? (fallbackDays ??= createDayStore(DEFAULT_TIME_ZONE));
  // Nur ein Wechsel des Vereinstags zeichnet neu; `stamp` liest „jetzt“ beim Zeichnen.
  const today = useSyncExternalStore(days.subscribe, days.getSnapshot, days.getSnapshot);
  return useMemo(
    () => ({
      mode,
      timeZone,
      date: (value: string | null | undefined) => formatDate(value, mode, timeZone),
      dateTime: (value: string | null | undefined, options?: DateTimeOptions) => formatDateTime(value, mode, timeZone, undefined, options),
      time: (value: string | Date | null | undefined) => formatTime(value, timeZone),
      stamp: (value: string | Date | null | undefined) => formatStamp(value, mode, timeZone, Date.now()),
    }),
    // `today` hält `stamp` frisch, wenn der Tag wechselt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, timeZone, today],
  );
}
