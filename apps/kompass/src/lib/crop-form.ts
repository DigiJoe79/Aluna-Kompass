import type { Crop } from './crop-geometry';

/**
 * Der Ausschnitt eines Bildfelds aus dem Formular (MediaPicker `cropName`, Spec Ausschnitt für alle Bilder § 4): leer =
 * `null` (entfernt; ein anderes Bild verwirft ihn ohnehin), JSON = Rechteck. Fehlt das Feld oder ist es unlesbar,
 * `undefined` — der Dienst behält dann den gespeicherten, solange das Bild bleibt. Ob das Rechteck gültig ist, prüft
 * der Dienst.
 */
export function cropFromForm(formData: FormData, name: string): Crop | null | undefined {
  if (!formData.has(name)) return undefined;
  const raw = String(formData.get(name) ?? '');
  if (raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Crop) : undefined;
  } catch {
    return undefined;
  }
}

/** `{ [key]: crop }` nur, wenn das Formular etwas zum Ausschnitt sagt — für `exactOptionalPropertyTypes`. */
export const withCrop = <K extends string>(key: K, crop: Crop | null | undefined): { [P in K]?: Crop | null } =>
  (crop === undefined ? {} : { [key]: crop }) as { [P in K]?: Crop | null };
