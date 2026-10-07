'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_TIME_ZONE, formatDate, formatDateTime, type DateFormatMode } from '@/lib/dates';

type DateFormat = { mode: DateFormatMode; timeZone: string };

// Ohne Provider (Tests, Seiten außerhalb der Schale) die Vorgabe des Kerns.
const DateFormatContext = createContext<DateFormat>({ mode: 'locale', timeZone: DEFAULT_TIME_ZONE });

/**
 * Die Schale setzt das Format aus der Einstellung `ui.dateFormat` und die Zone aus `organization.timeZone`
 * (`timeZoneOf`); Client-Bausteine lesen beides hier, Server-Seiten über `dateFormatOf` (`@/lib/date-format`). Aus einem
 * Zeitstempel wird so der Tag des Vereins.
 */
export function DateFormatProvider({ mode, timeZone, children }: { mode: DateFormatMode; timeZone: string; children: ReactNode }) {
  const value = useMemo(() => ({ mode, timeZone }), [mode, timeZone]);
  return <DateFormatContext.Provider value={value}>{children}</DateFormatContext.Provider>;
}

export function useDateFormat() {
  const { mode, timeZone } = useContext(DateFormatContext);
  return useMemo(
    () => ({
      mode,
      timeZone,
      date: (value: string | null | undefined) => formatDate(value, mode, timeZone),
      dateTime: (value: string | null | undefined) => formatDateTime(value, mode, timeZone),
    }),
    [mode, timeZone],
  );
}
