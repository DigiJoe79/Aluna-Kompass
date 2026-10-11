import { resolvePlaces, type ResolvedImagePlaces } from '@kompass/core/image-places';
import type { FieldSchema } from './types';

/**
 * Bildstellen der Template-Felder (Spec Ausschnitt für alle Bilder § 2): Ein `asset`-Feld trägt `ratio`/`width` in
 * seiner Meta. Die Stellen der Modul-Sichten löst der Kern auf (`imagePlaces`), mit derselben Abbildung. Rein, ohne
 * Datenbank — auch im Client (`client.ts`).
 */

export type { ImagePlace, ImagePlaceSpec, ImageRatio, ResolvedImagePlaces } from '@kompass/core/image-places';

/**
 * Die Stelle eines Template-Feldes. `label` ist der Name der Stelle, den der Aufrufer kennt (etwa die Sammlung
 * „Team“); ohne ihn der Feldname. Gilt auch für ein `asset` in `list`/`objectList` (die Meta steht an `items`).
 */
export function fieldImagePlaces(field: FieldSchema, label?: string): ResolvedImagePlaces {
  const name = label ?? field.label;
  const width = typeof field.width === 'number' ? field.width : undefined;
  return resolvePlaces({ ratio: field.ratio as never, ...(width === undefined ? {} : { width }) }, name ? { label: name } : {});
}
