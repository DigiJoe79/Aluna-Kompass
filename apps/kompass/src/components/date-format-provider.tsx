'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { formatDate, formatDateTime, type DateFormatMode } from '@/lib/dates';

const DateFormatContext = createContext<DateFormatMode>('locale');

/** Die Schale setzt das Format aus der Einstellung `ui.dateFormat`; Client-Bausteine lesen es hier. */
export function DateFormatProvider({ mode, children }: { mode: DateFormatMode; children: ReactNode }) {
  return <DateFormatContext.Provider value={mode}>{children}</DateFormatContext.Provider>;
}

export function useDateFormat() {
  const mode = useContext(DateFormatContext);
  return useMemo(
    () => ({
      mode,
      date: (value: string | null | undefined) => formatDate(value, mode),
      dateTime: (value: string | null | undefined) => formatDateTime(value, mode),
    }),
    [mode],
  );
}
