'use client';

import { useCallback, useState } from 'react';

/**
 * Befund 43 (Muster Kategorie-Panel, `1581b21d`): Die Version aus der
 * Speicher-Antwort gilt sofort. Wer vor dem Ende von `router.refresh()`
 * erneut öffnet oder schaltet, hätte sonst die alte Version im Zeilenzustand
 * und träfe `staleVersion`.
 */
export function useSavedVersions() {
  const [saved, setSaved] = useState<Record<string, string>>({});
  /** Merkt sich `updatedAt` aus der Antwort (`ActionState.data`), falls sie einen Datensatz trägt. */
  const remember = useCallback((data: unknown) => {
    const row = data as { id?: unknown; updatedAt?: unknown } | undefined;
    if (typeof row?.id === 'string' && typeof row.updatedAt === 'string') {
      const { id, updatedAt } = row as { id: string; updatedAt: string };
      setSaved((prev) => ({ ...prev, [id]: updatedAt }));
    }
  }, []);
  /** Die Zeile mit der neueren der beiden Versionen — gemerkt oder aus dem Refresh. */
  const latest = useCallback(
    <T extends { id: string; expectedVersion: string }>(row: T): T => {
      const version = saved[row.id];
      return version && version > row.expectedVersion ? { ...row, expectedVersion: version } : row;
    },
    [saved],
  );
  return { remember, latest };
}
