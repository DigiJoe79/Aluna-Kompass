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

/**
 * Die Adresse des Online-Profils eines Tiers, mit `{slug}` als Platzhalter.
 * Den Pfad legt das Template des Vereins fest, nicht Kompass (Spec
 * 2026-10-05, § 5); leer heißt: kein QR-Code, keine Adresse in der Maske.
 */
export const PROFILE_URL_KEY = 'animals.profileUrl';
export const profileUrlSchema = z.union([
  z.literal(''),
  z
    .string()
    .trim()
    .max(300)
    .regex(/^https?:\/\/\S+$/)
    .refine((value) => value.includes('{slug}'), { message: 'profileUrlNeedsSlug' }),
]);

export const ANIMALS_SETTINGS: SettingDefinition[] = [
  { key: PHOTO_FRAME_KEY, schema: photoFrameSchema, default: { aspect: '4:3', focusX: 50, focusY: 50 } satisfies PhotoFrame },
  { key: PROFILE_URL_KEY, schema: profileUrlSchema, default: '' },
];

/** Der Ausschnitt als CSS für ein Bild mit `object-fit: cover`. */
export function photoFrameStyle(frame: PhotoFrame): { aspectRatio: string; objectPosition: string } {
  const [w, h] = frame.aspect.split(':');
  return { aspectRatio: `${w} / ${h}`, objectPosition: `${frame.focusX}% ${frame.focusY}%` };
}
