import type { ImagePlace, ResolvedImagePlaces } from '@kompass/core/image-places';

/**
 * Eine Stelle der Webseite für Vorschau und Schwelle im Dialog „Ausschnitt“ (Handover alle Bilder, Signaturen): der
 * Name schon als Text, das Format der Stelle (`'original'` = wie gewählt) und die Breite, die die Pipeline für sie
 * höchstens erzeugt (`0` = keine Schwelle, etwa die Lightbox).
 */
export interface CropPlace {
  label: string;
  ratio: string;
  minWidthPx: number;
  lightbox?: boolean;
}

/**
 * Die aufgelösten Stellen (`imagePlaces`, `fieldImagePlaces`) mit Namen: `label` ist schon Text (Template-Feld),
 * `labelKey` ein voller Pfad in `messages/de.json` — `t` ist der Übersetzer ohne Namensraum. Ohne beides gilt
 * `fallbackLabel` (der Name des Feldes).
 */
export function cropPlaces(resolved: Pick<ResolvedImagePlaces, 'places'>, t: (key: string) => string, fallbackLabel = ''): CropPlace[] {
  const name = (p: ImagePlace) => p.label ?? (p.labelKey ? t(p.labelKey) : fallbackLabel);
  return resolved.places.map((p) => ({ label: name(p), ratio: p.ratio, minWidthPx: p.minWidthPx, ...(p.lightbox ? { lightbox: true } : {}) }));
}

/** Die Schwelle eines Bilds an mehreren Stellen: die anspruchsvollste (Handover alle Bilder 6). */
export const thresholdOf = (places: readonly Pick<CropPlace, 'minWidthPx'>[]): number => Math.max(0, ...places.map((p) => p.minWidthPx));
