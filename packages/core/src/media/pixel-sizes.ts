import { inArray } from 'drizzle-orm';
import { mediaAssets } from '../db/schema';
import type { Deps } from '../deps';
import { ID_PATTERN } from '../ids';
import { parseDerivedAssetId } from './derived-id';

export type PixelSizes = Record<string, { width: number; height: number }>;

/** Alle IDs unter den Zeichenketten eines Werts — die Bild-IDs eines Template-Werts stecken beliebig tief (Listen, Einträge). */
function strings(value: unknown, out: Set<string>): Set<string> {
  if (typeof value === 'string') {
    // Nur was wie eine ID aussieht: Texte eines Template-Werts gehören nicht in die Abfrage.
    const id = parseDerivedAssetId(value)?.assetId ?? value;
    if (ID_PATTERN.test(id)) out.add(id);
  }
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

/**
 * Pixelmaße (nach EXIF-Drehung, aus `media_assets`) der Bilder in `value` — einer Liste von IDs oder einem
 * beliebigen Wert, in dem IDs stehen; abgeleitete IDs zählen mit ihrer Basis. Ohne sie gibt es kein „Ausschnitt …“
 * und keinen Hinweis auf die Breite (Spec Ausschnitt für alle Bilder § 4). Reines Lesen von Maßen zu IDs, die die
 * Seite schon hat; das Recht prüft die Seite. Medien ohne Maße (SVG, PDF, Altbestand) und Unbekanntes fehlen.
 */
export function mediaPixelSizes(deps: Pick<Deps, 'db'>, value: unknown): PixelSizes {
  const ids = [...strings(value, new Set())];
  if (ids.length === 0) return {};
  const rows = deps.db.select({ id: mediaAssets.id, width: mediaAssets.width, height: mediaAssets.height }).from(mediaAssets).where(inArray(mediaAssets.id, ids)).all();
  return Object.fromEntries(rows.flatMap((r) => (r.width && r.height ? [[r.id, { width: r.width, height: r.height }]] : [])));
}
