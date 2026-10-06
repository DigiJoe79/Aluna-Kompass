import sharp from 'sharp';
import type { Deps } from '../deps';
import { readImageMeta } from './preview';
import type { MediaAssetRecord } from './service';

/**
 * Druckfassungen eines Bildes, neben dem Original abgelegt wie die Vorschau
 * der Mediathek (Spec 2026-10-05, § 4). Anders als die Vorschau entstehen sie
 * nie beim Hochladen, sondern erst, wenn jemand sie abruft — heute nur der
 * PDF-Export der Tiere. Ein Cache im Sinn von Prinzip 5: keine Spalte, kein
 * Protokoll, jederzeit aus dem Original neu berechenbar. JPEG, weil die
 * Dokumentenpipeline nur PNG und JPEG nimmt (`documentImageExtension`).
 */
export const IMAGE_VARIANTS = {
  print: { width: 1200, quality: 82 },
  printThumb: { width: 400, quality: 80 },
} as const;
export type ImageVariant = keyof typeof IMAGE_VARIANTS;

const RASTER = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Der Dateiname der Variante neben dem Original; kebab-case, weil der Dateispeicher nur Kleinbuchstaben nimmt (`assertSafeFilename`). */
export function variantFilename(filename: string, variant: ImageVariant): string {
  const suffix = variant.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return `${filename.replace(/\.[^.]+$/, '')}.${suffix}.jpg`;
}

/** Wirft bei unlesbarem Bild. Transparenz wird weiß: Papier ist weiß, und JPEG kennt keinen Alphakanal. */
export async function renderImageVariant(bytes: Uint8Array, variant: ImageVariant): Promise<Uint8Array> {
  const { width, quality } = IMAGE_VARIANTS[variant];
  const out = await sharp(bytes).rotate().resize({ width, withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
  return new Uint8Array(out);
}

/**
 * Liest die Variante oder baut sie, wenn sie fehlt; `null` für alles außer
 * Rasterbildern. `write` schluckt EEXIST wie bei `ensurePreview`: Zwei
 * gleichzeitige Abrufe stören sich nicht. Wirft bei unlesbarem Original.
 */
export async function ensureImageVariant(
  deps: Pick<Deps, 'media'>,
  record: Pick<MediaAssetRecord, 'filename' | 'mimeType'>,
  variant: ImageVariant,
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  if (!RASTER.has(record.mimeType)) return null;
  const name = variantFilename(record.filename, variant);
  let bytes: Uint8Array;
  if (await deps.media.exists(name)) {
    bytes = await deps.media.read(name);
  } else {
    bytes = await renderImageVariant(await deps.media.read(record.filename), variant);
    await deps.media.write(name, bytes);
  }
  return { bytes, ...(await readImageMeta(bytes)) };
}
