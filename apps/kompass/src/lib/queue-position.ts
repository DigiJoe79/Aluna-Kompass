export interface QueuePosition {
  index: number;
  total: number;
  previousId: string | null;
  nextId: string | null;
}

/**
 * Position in einer Liste von IDs. `null`, wenn die ID nicht (mehr) in der
 * Auswahl steht. `index` zählt ab 1.
 *
 * Die Warteschlange einer Maske ist die gefilterte, sortierte Liste, aus der
 * man kam – kein eigener Zustand auf dem Server oder im Browser.
 */
export function queuePosition(ids: readonly string[], currentId: string): QueuePosition | null {
  const at = ids.indexOf(currentId);
  if (at < 0) return null;
  return { index: at + 1, total: ids.length, previousId: ids[at - 1] ?? null, nextId: ids[at + 1] ?? null };
}
