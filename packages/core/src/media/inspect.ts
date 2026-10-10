import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { readImageMeta } from './preview';

/** Rasterbilder, die ein Modul außerhalb der Mediathek annimmt (Vorschlags-Eingang § 7): kein SVG, kein PDF. */
export const RASTER_IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
export type RasterImageType = keyof typeof RASTER_IMAGE_TYPES;
export interface RasterImage {
  mimeType: RasterImageType;
  ext: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
  checksum: string;
  bytes: number;
}

/**
 * Typ nach Inhalt (nie nach Name), Maße über sharp — ein Bild, das sharp nicht lesen kann, ist keins.
 * `null`, wenn es kein lesbares JPEG/PNG/WebP ist. Größe prüft der Aufrufer (`MEDIA_MAX_BYTES`).
 */
export async function inspectRasterImage(bytes: Uint8Array): Promise<RasterImage | null> {
  const sniffed = await fileTypeFromBuffer(bytes);
  if (!sniffed || !(sniffed.mime in RASTER_IMAGE_TYPES)) return null;
  const mimeType = sniffed.mime as RasterImageType;
  try {
    const { width, height } = await readImageMeta(bytes);
    return {
      mimeType,
      ext: RASTER_IMAGE_TYPES[mimeType],
      width,
      height,
      checksum: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
    };
  } catch {
    return null;
  }
}
