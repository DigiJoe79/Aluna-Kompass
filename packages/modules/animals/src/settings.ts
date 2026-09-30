import type { SettingDefinition } from '@kompass/core';
import { z } from 'zod';

/**
 * Der Ausschnitt, in dem die Webseite das Hauptfoto eines Tiers zeigt: Seitenverhältnis und Blickpunkt in
 * Prozent (wie `object-position`). Welches Format gilt, entscheidet das Template des Vereins, nicht Kompass;
 * die Maske zeigt die Fotos im selben Ausschnitt, damit man beim Wählen des Hauptfotos sieht, was die Seite
 * zeigt (Befund Joe, 2026-09-30). Vorgabe ist das Format, das die Maske vorher fest zeigte.
 */
export const PHOTO_FRAME_KEY = 'animals.photoFrame';

const percent = z.number().int().min(0).max(100);
export const photoFrameSchema = z.object({
  /** Breite zu Höhe, etwa `4:5` für Hochformat. */
  aspect: z.string().regex(/^[1-9]\d?:[1-9]\d?$/),
  focusX: percent,
  focusY: percent,
});
export type PhotoFrame = z.infer<typeof photoFrameSchema>;

export const ANIMALS_SETTINGS: SettingDefinition[] = [
  { key: PHOTO_FRAME_KEY, schema: photoFrameSchema, default: { aspect: '4:3', focusX: 50, focusY: 50 } satisfies PhotoFrame },
];

/** Der Ausschnitt als CSS für ein Bild mit `object-fit: cover`. */
export function photoFrameStyle(frame: PhotoFrame): { aspectRatio: string; objectPosition: string } {
  const [w, h] = frame.aspect.split(':');
  return { aspectRatio: `${w} / ${h}`, objectPosition: `${frame.focusX}% ${frame.focusY}%` };
}
