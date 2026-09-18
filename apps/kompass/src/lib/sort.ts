export type SortDirection = 'asc' | 'desc';

/**
 * Sortierung lebt in der URL (`sort`, `dir`), damit sie Blättern und den
 * Zurück-Knopf überlebt. Serverseitig sortiert, weil die Listen blättern —
 * im Browser sortiert wäre nur die sichtbare Seite umgedreht.
 *
 * Steht bewusst nicht in `sortable-head.tsx`: Die Komponente ist `'use client'`,
 * und eine Seite auf dem Server darf aus einem Client-Modul keine Funktion
 * rufen. Die Regel liest also der Server, den Knopf zeichnet der Browser.
 */
export function readSort<F extends string>(
  params: { sort?: string; dir?: string },
  allowed: readonly F[],
): { field: F; direction: SortDirection } | undefined {
  const field = params.sort;
  if (!field || !allowed.includes(field as F)) return undefined;
  return { field: field as F, direction: params.dir === 'asc' ? 'asc' : 'desc' };
}
