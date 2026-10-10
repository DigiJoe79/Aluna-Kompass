import { parseFolderPath, type SettingDefinition } from '@kompass/core';
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

/** Vorschlags-Eingang (Spec 2026-10-09, § 4): Vorschläge von Quellen annehmen. Vorgabe aus. */
export const PROPOSALS_ENABLED_KEY = 'animals.proposals.enabled';
/** Prüfmerker beim Schreiben über MCP (bis 0.2.9 immer an). Seit 0.2.10 eine Einstellung, Vorgabe aus. */
export const REVIEW_ON_MCP_WRITE_KEY = 'animals.review.onMcpWrite';
/** Wisch-Stapel „Durchgehen“ in der Inbox. Vorgabe aus, bis er mit dem Verein bewertet ist (Joe 2026-10-10, Backlog 68). */
export const PROPOSAL_STACK_KEY = 'animals.proposals.stack';
/** Ordner der Mediathek, in den angenommene Bilder gehen; '' = Wurzel. Fehlt der Ordner, landet das Bild in der Wurzel (Verhalten von `storeMediaInternal`). */
export const PROPOSAL_PHOTO_FOLDER_KEY = 'animals.proposals.photoFolder';
const folderSchema = z.union([
  z.literal(''),
  z.string().refine((v) => parseFolderPath(v) === v, { message: 'invalidFolderPath' }),
]);

export const ANIMALS_SETTINGS: SettingDefinition[] = [
  { key: PHOTO_FRAME_KEY, schema: photoFrameSchema, default: { aspect: '4:3', focusX: 50, focusY: 50 } satisfies PhotoFrame },
  { key: PROFILE_URL_KEY, schema: profileUrlSchema, default: '' },
  { key: PROPOSALS_ENABLED_KEY, schema: z.boolean(), default: false },
  { key: REVIEW_ON_MCP_WRITE_KEY, schema: z.boolean(), default: false },
  { key: PROPOSAL_PHOTO_FOLDER_KEY, schema: folderSchema, default: '' },
  { key: PROPOSAL_STACK_KEY, schema: z.boolean(), default: false },
];

/** Der Ausschnitt als CSS für ein Bild mit `object-fit: cover`. */
export function photoFrameStyle(frame: PhotoFrame): { aspectRatio: string; objectPosition: string } {
  const [w, h] = frame.aspect.split(':');
  return { aspectRatio: `${w} / ${h}`, objectPosition: `${frame.focusX}% ${frame.focusY}%` };
}
