import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_DIR } from './content';

export interface ImageVariant {
  src: string;
  srcset: string;
  width: number;
  height: number;
}

let cache: Promise<Record<string, ImageVariant>> | null = null;

/** Die von Kompass aufbereiteten Bildvarianten, Asset-ID → Variante. */
export function loadImages(): Promise<Record<string, ImageVariant>> {
  cache ??= readFile(path.join(CONTENT_DIR, 'images.json'), 'utf8')
    .then((raw) => JSON.parse(raw) as Record<string, ImageVariant>)
    .catch(() => ({}));
  return cache;
}

export function imageFor(
  images: Record<string, ImageVariant>,
  assetId: string | null | undefined,
): ImageVariant | null {
  return assetId ? (images[assetId] ?? null) : null;
}
