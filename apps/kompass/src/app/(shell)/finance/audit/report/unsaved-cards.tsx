'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Welche Karten des Prüfberichts ungespeicherte Änderungen tragen (Plan D1d Task 6): Jede Karte meldet ihren Titel,
 * solange sie geändert ist; der Kopf nennt sie in der Rückfrage „Zum Unterschreiben freigeben“. Nur Zustand, keine
 * Oberfläche.
 */
interface UnsavedCards {
  titles: string[];
  set: (key: string, title: string | null) => void;
}

const Context = createContext<UnsavedCards | null>(null);

export function UnsavedCardsProvider({ children }: { children: React.ReactNode }) {
  const [byKey, setByKey] = useState<Record<string, string>>({});
  const set = useCallback((key: string, title: string | null) => {
    setByKey((prev) => {
      if ((prev[key] ?? null) === title) return prev;
      const next = { ...prev };
      if (title === null) delete next[key];
      else next[key] = title;
      return next;
    });
  }, []);
  const value = useMemo(() => ({ titles: Object.values(byKey), set }), [byKey, set]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Eine Karte meldet sich als geändert (`dirty`) mit ihrem Titel; beim Verschwinden meldet sie sich ab. */
export function useUnsavedCard(key: string, title: string, dirty: boolean): void {
  const set = useContext(Context)?.set;
  useEffect(() => {
    set?.(key, dirty ? title : null);
  }, [set, key, title, dirty]);
  useEffect(() => () => set?.(key, null), [set, key]);
}

/** Die Titel der Karten mit ungespeicherten Änderungen, in der Reihenfolge ihrer Meldung. */
export function useUnsavedCardTitles(): string[] {
  return useContext(Context)?.titles ?? [];
}
