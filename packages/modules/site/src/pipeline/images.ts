import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { derivedAssetId, newId, type CropRect } from '@kompass/core';
import sharp, { type Metadata } from 'sharp';
import type { ExportedAsset } from '../export';
import { SITE_CACHE_VERSION } from './env';

import { IMAGE_WIDTHS, MAIN_IMAGE_MAX_WIDTH } from '@kompass/core/image-places';

// Seit 0.2.11 im Kern, weil auch die Schwelle der Bildstellen sie braucht (Spec Ausschnitt für alle Bilder § 2).
export { IMAGE_WIDTHS, MAIN_IMAGE_MAX_WIDTH } from '@kompass/core/image-places';
export interface ImageVariant {
  src: string;
  srcset: string;
  width: number;
  height: number;
}

export interface SkippedImage {
  assetId: string;
  filename: string;
  reason: 'noWidth' | 'decodeFailed';
}

export interface ImageVariantsResult {
  variants: Record<string, ImageVariant>;
  skipped: SkippedImage[];
  /** Neu erzeugte Varianten (nicht aus dem Cache). */
  generated: number;
  /** Die Cache-Dateien, die dieser Lauf gebraucht hat — was `sweepImageCache` stehen lässt. */
  cacheNames: Set<string>;
}

const RASTER = new Set(['image/png', 'image/jpeg', 'image/webp']);
const hashOf = (filename: string): string => /-([0-9a-f]{12})\.[a-z0-9]+$/i.exec(filename)?.[1] ?? filename.replace(/\.[^.]+$/, '');
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/**
 * Räumt den Cache vor dem Lauf: Varianten anderer Fassungen und Reste eines
 * abgebrochenen Laufs (`*.tmp-*`) fliegen raus. Die Cache-Version steht im
 * Dateinamen, damit ein geänderter Encoder nie alte Varianten ausliefert.
 */
export async function pruneImageCache(cacheDir: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(cacheDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const stale = /\.tmp-/.test(name) || (name.endsWith('.webp') && !name.startsWith(`${SITE_CACHE_VERSION}-`));
    if (!stale) continue;
    await rm(path.join(cacheDir, name), { force: true });
    removed++;
  }
  return removed;
}

/**
 * Wie lange eine ungebrauchte Variante im Cache bleibt (Backlog 67, Joe 2026-10-10): Puffer für kurz depublizierte
 * Hunde und für Vorschauen mit unveröffentlichten Datensätzen, die sonst beim nächsten Publish neu gerechnet würden.
 */
export const IMAGE_CACHE_MAX_AGE_DAYS = 30;

/**
 * Räumt den Cache nach einem erfolgreichen Publish der Produktion: Varianten der aktuellen Cache-Version, die der
 * Lauf nicht gebraucht hat und deren Zeitstempel älter als `maxAgeDays` ist. Andere Fassungen und Temp-Reste räumt
 * `pruneImageCache`. Die Zeit ist Dateizeit (Wanduhr), nicht die Uhr der Fachlogik: Verglichen wird mit `mtime`.
 */
export async function sweepImageCache(cacheDir: string, used: ReadonlySet<string>, now: Date = new Date(), maxAgeDays = IMAGE_CACHE_MAX_AGE_DAYS): Promise<{ removed: number; bytes: number }> {
  let names: string[];
  try {
    names = await readdir(cacheDir);
  } catch {
    return { removed: 0, bytes: 0 };
  }
  const cutoff = now.getTime() - maxAgeDays * 86_400_000;
  let removed = 0;
  let bytes = 0;
  for (const name of names) {
    if (!name.startsWith(`${SITE_CACHE_VERSION}-`) || !name.endsWith('.webp') || used.has(name)) continue;
    const info = await stat(path.join(cacheDir, name)).catch(() => null);
    if (!info?.isFile() || info.mtimeMs >= cutoff) continue;
    await rm(path.join(cacheDir, name), { force: true });
    removed++;
    bytes += info.size;
  }
  return { removed, bytes };
}

interface PlannedVariant {
  w: number;
  h: number;
  outName: string;
  cacheName: string;
}
interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface Planned {
  asset: ExportedAsset;
  source: string;
  svg: boolean;
  hash: string;
  /** Ausschnitt in Pixeln des gedrehten Originals; `null` ohne Ausschnitt. */
  rect: PixelRect | null;
  variants: PlannedVariant[];
}

/** Rechteck aus Anteilen in Pixel des (gedrehten) Bildes, gerundet und ins Bild geklemmt, mindestens 1 px. */
function pixelRect(crop: CropRect, width: number, height: number): PixelRect {
  const left = Math.min(Math.max(0, Math.round(crop.x * width)), width - 1);
  const top = Math.min(Math.max(0, Math.round(crop.y * height)), height - 1);
  return {
    left,
    top,
    width: Math.min(Math.max(1, Math.round(crop.w * width)), width - left),
    height: Math.min(Math.max(1, Math.round(crop.h * height)), height - top),
  };
}

class ImageDecodeError extends Error {}

/**
 * Erzeugt die Bildvarianten für die Webseite. Der Cache-Name trägt den
 * Inhalts-Hash der Bytes (nicht den Dateinamen: Bildausschnitt und Import
 * behalten ihren Namen bei neuem Inhalt), und jede Variante entsteht unter
 * einem Temp-Namen und wird erst fertig umbenannt — ein abgebrochener Lauf
 * hinterlässt nie eine halbe Datei, die der nächste für gültig hält. Ein
 * Bild, das sich nicht lesen lässt, wird übersprungen und mit Namen gemeldet.
 * Ein Asset mit `crop` (abgeleitete ID, Spec Bildausschnitt § 2) wird nach der
 * EXIF-Drehung zugeschnitten; seine Breiten reichen bis zur Ausschnittbreite,
 * Cache- und Ausgabename tragen das Rechteck.
 */
export async function prepareImageVariants(opts: {
  jobDir: string;
  assets: ExportedAsset[];
  cacheDir: string;
  signal?: AbortSignal;
  concurrency?: number;
  onPlan?: (p: { total: number; missing: number }) => void;
  onProgress?: (done: number, total: number, generated: number) => void;
  /** Zeitstempel für Cache-Treffer; Standard jetzt (Dateizeit). */
  now?: Date;
}): Promise<ImageVariantsResult> {
  const outDir = path.join(opts.jobDir, 'images');
  await mkdir(outDir, { recursive: true });
  await mkdir(opts.cacheDir, { recursive: true });
  await pruneImageCache(opts.cacheDir);

  // Plan: Kopf jedes Bildes lesen, Breiten und Cache-Namen bestimmen.
  const skipped: SkippedImage[] = [];
  const planned: Planned[] = [];
  for (const asset of [...opts.assets].sort((a, b) => a.id.localeCompare(b.id))) {
    opts.signal?.throwIfAborted();
    const source = path.join(opts.jobDir, 'assets', asset.filename);
    const hash = hashOf(asset.filename);
    if (asset.mimeType === 'image/svg+xml') {
      planned.push({ asset, source, svg: true, hash, rect: null, variants: [] });
      continue;
    }
    if (!RASTER.has(asset.mimeType)) continue;
    const bytes = await readFile(source);
    let meta: Metadata;
    try {
      meta = await sharp(bytes).metadata();
    } catch {
      skipped.push({ assetId: asset.id, filename: asset.filename, reason: 'decodeFailed' });
      continue;
    }
    const originalWidth = meta.width ?? 0;
    const originalHeight = meta.height ?? 0;
    if (originalWidth === 0) {
      skipped.push({ assetId: asset.id, filename: asset.filename, reason: 'noWidth' });
      continue;
    }
    const key = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    // Ausschnitt, Breiten und Maße beziehen sich auf das gedrehte Bild (Orientation 5–8 tauscht Breite und Höhe).
    const swapped = (meta.orientation ?? 1) >= 5;
    const turnedWidth = swapped ? originalHeight : originalWidth;
    const turnedHeight = swapped ? originalWidth : originalHeight;
    const rect = asset.crop ? pixelRect(asset.crop, turnedWidth, turnedHeight) : null;
    const srcWidth = rect?.width ?? turnedWidth;
    const srcHeight = rect?.height ?? turnedHeight;
    // Teil nach `~` der abgeleiteten ID, aus dem Rechteck gebildet statt aus der ID gelesen.
    const tag = asset.crop ? `-${derivedAssetId('', asset.crop).slice(1)}` : '';
    const widths = [...new Set([...IMAGE_WIDTHS.filter((w) => w < srcWidth), srcWidth])].sort((a, b) => a - b);
    planned.push({
      asset,
      source,
      svg: false,
      hash,
      rect,
      variants: widths.map((w) => ({ w, h: Math.max(1, Math.round((srcHeight * w) / srcWidth)), outName: `${hash}${tag}-${w}.webp`, cacheName: `${SITE_CACHE_VERSION}-${key}${tag}-${w}.webp` })),
    });
  }
  const total = planned.reduce((n, p) => n + (p.svg ? 1 : p.variants.length), 0);
  let missing = 0;
  for (const p of planned) for (const v of p.variants) if (!(await exists(path.join(opts.cacheDir, v.cacheName)))) missing++;
  opts.onPlan?.({ total, missing });

  // Arbeit: wenige Arbeiter, jedes Bild einmal dekodiert.
  let done = 0;
  let generated = 0;
  const tick = (n = 1) => {
    done += n;
    opts.onProgress?.(done, total, generated);
  };
  const failed = new Set<string>();
  const work = async (item: Planned): Promise<void> => {
    opts.signal?.throwIfAborted();
    if (item.svg) {
      await copyFile(item.source, path.join(outDir, `${item.hash}.svg`));
      tick();
      return;
    }
    const base = sharp(await readFile(item.source), { failOn: 'error' }).rotate();
    let handled = 0;
    try {
      for (const v of item.variants) {
        const cached = path.join(opts.cacheDir, v.cacheName);
        if (await exists(cached)) {
          // Ein Treffer gilt als Gebrauch: Der Zeitstempel hält die Datei aus `sweepImageCache` heraus. Scheitert das
          // (fremder Besitzer im Volume, eben gefegt), wird sie höchstens früher gefegt — kein Grund, den Lauf abzubrechen.
          const now = opts.now ?? new Date();
          await utimes(cached, now, now).catch(() => undefined);
        } else {
          const temp = `${cached}.tmp-${process.pid}-${newId()}`;
          try {
            const cut = item.rect ? base.clone().extract(item.rect) : base.clone();
            await cut.resize({ width: v.w, withoutEnlargement: true }).webp({ quality: 80, effort: 4 }).toFile(temp);
            await rename(temp, cached);
            generated++;
          } catch (error) {
            await rm(temp, { force: true });
            throw new ImageDecodeError(String(error));
          }
        }
        await copyFile(cached, path.join(outDir, v.outName));
        handled++;
        tick();
      }
    } catch (error) {
      if (!(error instanceof ImageDecodeError)) throw error;
      failed.add(item.asset.id);
      skipped.push({ assetId: item.asset.id, filename: item.asset.filename, reason: 'decodeFailed' });
      for (const v of item.variants) await rm(path.join(outDir, v.outName), { force: true });
      tick(item.variants.length - handled);
    }
  };
  const queue = [...planned];
  const workers = Array.from({ length: Math.max(1, opts.concurrency ?? 2) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) await work(item);
  });
  await Promise.all(workers);

  const variants: Record<string, ImageVariant> = {};
  for (const p of planned) {
    if (failed.has(p.asset.id)) continue;
    if (p.svg) {
      variants[p.asset.id] = { src: `/images/${p.hash}.svg`, srcset: '', width: 0, height: 0 };
      continue;
    }
    const main = [...p.variants].reverse().find((e) => e.w <= MAIN_IMAGE_MAX_WIDTH) ?? p.variants[0]!;
    variants[p.asset.id] = {
      src: `/images/${main.outName}`,
      srcset: p.variants.map((e) => `/images/${e.outName} ${e.w}w`).join(', '),
      width: main.w,
      height: main.h,
    };
  }
  await writeFile(path.join(opts.jobDir, 'images.json'), JSON.stringify(variants, null, 2));
  const cacheNames = new Set(planned.filter((p) => !failed.has(p.asset.id)).flatMap((p) => p.variants.map((v) => v.cacheName)));
  return { variants, skipped: skipped.sort((a, b) => a.assetId.localeCompare(b.assetId)), generated, cacheNames };
}
