/**
 * Abgeleitete Bild-ID für ein Foto mit Ausschnitt (Spec Bildausschnitt § 2): `<assetId>~<x>_<y>_<w>_<h>`, jeder
 * Wert als ganze Zahl in Zehntausendsteln. Die Sicht gibt sie statt der Foto-ID aus, Export und Pipeline lösen sie
 * wieder auf; der Template-Vertrag bleibt so unverändert.
 *
 * Das Trennzeichen `~` kommt in Asset-IDs nicht vor: `newId()` erzeugt ULIDs aus Crockford-Base32
 * (`[0-9A-HJKMNP-TV-Z]`), siehe `ID_PATTERN` in `../ids.ts`.
 */

import { z } from 'zod';

/** Rechteck als Anteile am (EXIF-gedrehten) Original; strukturell gleich `PhotoCrop` des Tier-Moduls. */
export interface CropRect { x: number; y: number; w: number; h: number }

const unit = z.number().min(0).max(1);
/**
 * Der Ausschnitt einer Verwendung (Tierfoto, Geschichte, Projektbild) als Eingabe: normiertes Rechteck, vier
 * Nachkommastellen genügen. Ob es im Bild liegt, prüft der Dienst (`cropOutOfBounds`), nicht das Schema:
 * Werkzeugschemas tragen keine Prüfung über mehrere Felder (Wächter mcp-conditional-required).
 */
export const cropRectSchema = z.object({ x: unit, y: unit, w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) }).strict();

/** Vier Nachkommastellen (0,1 px bei 1000 px), damit gleiche Ausschnitte gleich gespeichert werden. */
export const roundCropRect = (c: CropRect): CropRect => ({ x: +c.x.toFixed(4), y: +c.y.toFixed(4), w: +c.w.toFixed(4), h: +c.h.toFixed(4) });

/** Ragt ein Ausschnitt über das Bild hinaus? Toleranz 0,0001 für gerundete Ränder. */
export const cropOutOfBounds = (c: CropRect | null | undefined): boolean => !!c && (c.x + c.w > 1.0001 || c.y + c.h > 1.0001);

const SEPARATOR = '~';
const SCALE = 10000;
const INT = /^(0|[1-9]\d*)$/;

/**
 * Rundet wie `roundCrop` (vier Nachkommastellen), damit gleiche Ausschnitte gleiche IDs ergeben. Der Dienst lässt
 * beim Rand eine Toleranz von 0,0001 zu (`cropIssues`); Breite und Höhe werden deshalb ins Bild geklemmt, damit
 * jede erzeugte ID wieder lesbar ist.
 */
function toUnits(crop: CropRect): [number, number, number, number] {
  const r = (v: number) => (Number.isFinite(v) ? Math.min(SCALE, Math.max(0, Math.round(v * SCALE))) : 0);
  const x = Math.min(r(crop.x), SCALE - 1);
  const y = Math.min(r(crop.y), SCALE - 1);
  const w = Math.max(1, Math.min(r(crop.w), SCALE - x));
  const h = Math.max(1, Math.min(r(crop.h), SCALE - y));
  return [x, y, w, h];
}

export function derivedAssetId(assetId: string, crop: CropRect | null | undefined): string {
  if (!crop) return assetId;
  return `${assetId}${SEPARATOR}${toUnits(crop).join('_')}`;
}

/** `{ assetId, crop }` für eine abgeleitete ID; `null` für eine gewöhnliche ID oder einen ungültigen Rest. */
export function parseDerivedAssetId(id: string): { assetId: string; crop: CropRect } | null {
  const at = id.indexOf(SEPARATOR);
  if (at <= 0) return null;
  const assetId = id.slice(0, at);
  const parts = id.slice(at + 1).split('_');
  if (parts.length !== 4 || !parts.every((p) => INT.test(p))) return null;
  const [x, y, w, h] = parts.map(Number) as [number, number, number, number];
  if ([x, y, w, h].some((v) => v > SCALE)) return null;
  if (w <= 0 || h <= 0 || x + w > SCALE || y + h > SCALE) return null;
  return { assetId, crop: { x: x / SCALE, y: y / SCALE, w: w / SCALE, h: h / SCALE } };
}
