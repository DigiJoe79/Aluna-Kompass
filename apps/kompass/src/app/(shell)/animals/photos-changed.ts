type Photo = { assetId: string; isPrimary: boolean };

/** Ob die Auswahl der Maske vom gespeicherten Stand abweicht: Reihenfolge, Bestand oder Hauptfoto. */
export function photosChanged(saved: readonly Photo[], next: readonly Photo[]): boolean {
  if (saved.length !== next.length) return true;
  return saved.some((p, i) => p.assetId !== next[i]!.assetId || p.isPrimary !== next[i]!.isPrimary);
}

/**
 * Liest das versteckte Feld `photos` (JSON). Fehlt es oder ist es kein
 * gültiges Array, `null` – dann fasst die Action die Fotos nicht an. Reine
 * Funktion ohne React, damit sie in Vitest direkt prüfbar bleibt.
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
    const { assetId, isPrimary } = entry as Record<string, unknown>;
    if (typeof assetId !== 'string' || assetId === '' || typeof isPrimary !== 'boolean') return null;
    photos.push({ assetId, isPrimary });
  }
  return photos;
}
