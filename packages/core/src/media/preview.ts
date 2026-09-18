import sharp from 'sharp';
import type { Deps } from '../deps';
import type { MediaAssetRecord } from './service';

/**
 * Die Vorschau der Mediathek: 320 px breit, WebP, neben dem Original abgelegt.
 * Ein Cache im Sinn von Prinzip 5 — keine Spalte, kein Protokoll, jederzeit
 * aus dem Original neu berechenbar. Fehlt sie (Bestand von vor der Einführung,
 * von Hand gelöscht), baut `ensurePreview` sie beim nächsten Abruf.
 */
export const PREVIEW_WIDTH = 320;
const PREVIEW_SUFFIX = '.preview.webp';
const RASTER = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function previewFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') + PREVIEW_SUFFIX;
}

export function hasPreview(mimeType: string): boolean {
  return RASTER.has(mimeType);
}

/** Maße nach EXIF-Drehung, so wie ein Browser das Bild zeigt. Wirft bei unlesbarem Bild. */
export async function readImageMeta(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) throw new Error('image without dimensions');
  const swapped = (meta.orientation ?? 1) >= 5;
  return swapped ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

/** Wirft bei unlesbarem Bild — der Aufrufer entscheidet, was das für den Upload heißt. */
export async function renderPreview(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(bytes).rotate().resize({ width: PREVIEW_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  return new Uint8Array(out);
}

/**
 * Liest die Vorschau, baut sie nach, wenn sie fehlt. SVG hat keine — das
 * Original ist klein und skaliert selbst; PDF hat keine — `null`.
 * `write` schluckt EEXIST: Zwei gleichzeitige Abrufe stören sich nicht.
 */
export async function ensurePreview(deps: Pick<Deps, 'media'>, record: Pick<MediaAssetRecord, 'filename' | 'mimeType'>): Promise<Uint8Array | null> {
  if (record.mimeType === 'image/svg+xml') return deps.media.read(record.filename);
  if (!hasPreview(record.mimeType)) return null;
  const name = previewFilename(record.filename);
  if (await deps.media.exists(name)) return deps.media.read(name);
  const bytes = await renderPreview(await deps.media.read(record.filename));
  await deps.media.write(name, bytes);
  return bytes;
}
