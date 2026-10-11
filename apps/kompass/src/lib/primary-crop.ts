import type { Crop } from './crop-geometry';

/**
 * Die Ausschnitte einer Fotoliste je Schlüssel (`crops`) und die beim Titelbildwechsel entfernten (`removed`). Lebt im
 * Stand der Seite: bis zum Annehmen in der Prüfung, bis Speichern oder Verwerfen im Tierformular.
 */
export interface CropMemory {
  crops: Readonly<Record<string, Crop | null>>;
  removed: Readonly<Record<string, Crop>>;
}

/**
 * Titelbild wechseln (Spec Ausschnitt in der Prüfung § 2.4, Board 4) — eine Regel für Prüfung und Tierformular. Das
 * alte Titelbild verliert seinen Ausschnitt (er gilt fürs Titelbild-Format) und die Seite merkt ihn; wird dasselbe
 * Foto wieder Titelbild, kommt er zurück. Das neue Titelbild behält seinen Ausschnitt, ohne einen keinen automatischen.
 * `from.stays`: Bleibt das alte Titelbild im Tier? Weggelassen oder abgewählt behält es seinen Ausschnitt, damit er
 * beim Wiederherstellen mitkommt (Board A). `removedFrom`: nur, wenn wirklich ein Ausschnitt entfernt wurde — dann
 * und nur dann sagt die Seite es an (`media.crop.primaryMoved`).
 */
export function switchPrimaryCrop(state: CropMemory, from: { key: string; stays: boolean } | null, to: string | null): CropMemory & { removedFrom: string | null } {
  if (!from || from.key === to) return { ...state, removedFrom: null };
  const crops = { ...state.crops };
  const removed = { ...state.removed };
  let removedFrom: string | null = null;
  const old = crops[from.key];
  if (from.stays && old) {
    removed[from.key] = old;
    crops[from.key] = null;
    removedFrom = from.key;
  }
  const back = to === null ? undefined : removed[to];
  if (to !== null && back) {
    crops[to] = back;
    delete removed[to];
  }
  return { crops, removed, removedFrom };
}

/** „Übernehmen“ im Dialog: setzt den Ausschnitt und verwirft, was die Seite für dieses Foto gemerkt hatte. */
export function applyCrop(state: CropMemory, key: string, crop: Crop | null): CropMemory {
  const removed = { ...state.removed };
  delete removed[key];
  return { crops: { ...state.crops, [key]: crop }, removed };
}
