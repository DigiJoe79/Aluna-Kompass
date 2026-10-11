import { roundCrop, type Crop } from '@/lib/crop-geometry';

/** `crop`: Rechteck, `null` = entfernen, weggelassen = gespeicherten Ausschnitt behalten (wie der Dienst). */
type Photo = { assetId: string; isPrimary: boolean; crop?: Crop | null };

const sameCrop = (a: Crop | null, b: Crop | null): boolean => (a === null || b === null ? a === b : JSON.stringify(roundCrop(a)) === JSON.stringify(roundCrop(b)));

/** Ob die Auswahl der Maske vom gespeicherten Stand abweicht: Reihenfolge, Bestand, Hauptfoto oder Ausschnitt (gerundet verglichen). */
export function photosChanged(saved: readonly Photo[], next: readonly Photo[]): boolean {
  if (saved.length !== next.length) return true;
  return saved.some((p, i) => {
    const n = next[i]!;
    return p.assetId !== n.assetId || p.isPrimary !== n.isPrimary || (n.crop !== undefined && !sameCrop(p.crop ?? null, n.crop));
  });
}

const isCrop = (v: unknown): v is Crop => typeof v === 'object' && v !== null && ['x', 'y', 'w', 'h'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number');

/**
 * Liest das versteckte Feld `photos` (JSON). Fehlt es oder ist es kein
 * gültiges Array, `null` – dann fasst die Action die Fotos nicht an. Der
 * Ausschnitt reist je Foto mit (die Maske schickt immer ihren Stand); ob er im
 * Bild liegt, prüft der Dienst (`cropIssues`). Reine Funktion ohne React, damit
 * sie in Vitest direkt prüfbar bleibt.
 */
export function photosFromForm(value: FormDataEntryValue | null): Photo[] | null {
  if (typeof value !== 'string' || value === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const photos: Photo[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { assetId, isPrimary, crop } = entry as Record<string, unknown>;
    if (typeof assetId !== 'string' || assetId === '' || typeof isPrimary !== 'boolean') return null;
    if (crop === undefined) photos.push({ assetId, isPrimary });
    else if (crop === null) photos.push({ assetId, isPrimary, crop: null });
    else if (isCrop(crop)) photos.push({ assetId, isPrimary, crop: { x: crop.x, y: crop.y, w: crop.w, h: crop.h } });
    else return null;
  }
  return photos;
}
