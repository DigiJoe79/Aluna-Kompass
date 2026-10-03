import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { newId } from '@kompass/core';
import sharp, { type Metadata } from 'sharp';
import type { ExportedAsset } from '../export';
import { SITE_CACHE_VERSION } from './env';

export const IMAGE_WIDTHS = [480, 960, 1600] as const;
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

interface PlannedVariant {
  w: number;
  h: number;
  outName: string;
  cacheName: string;
}
interface Planned {
  asset: ExportedAsset;
  source: string;
  svg: boolean;
  hash: string;
  variants: PlannedVariant[];
}

class ImageDecodeError extends Error {}

/**
 * Erzeugt die Bildvarianten für die Webseite. Der Cache-Name trägt den
 * Inhalts-Hash der Bytes (nicht den Dateinamen: Bildausschnitt und Import
 * behalten ihren Namen bei neuem Inhalt), und jede Variante entsteht unter
 * einem Temp-Namen und wird erst fertig umbenannt — ein abgebrochener Lauf
 * hinterlässt nie eine halbe Datei, die der nächste für gültig hält. Ein
 * Bild, das sich nicht lesen lässt, wird übersprungen und mit Namen gemeldet.
 */
export async function prepareImageVariants(opts: {
  jobDir: string;
  assets: ExportedAsset[];
  cacheDir: string;
  signal?: AbortSignal;
  concurrency?: number;
  onPlan?: (p: { total: number; missing: number }) => void;
  onProgress?: (done: number, total: number, generated: number) => void;
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
      planned.push({ asset, source, svg: true, hash, variants: [] });
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
    const widths = [...new Set([...IMAGE_WIDTHS.filter((w) => w < originalWidth), originalWidth])].sort((a, b) => a - b);
    planned.push({
      asset,
      source,
      svg: false,
      hash,
      variants: widths.map((w) => ({ w, h: Math.round((originalHeight * w) / originalWidth), outName: `${hash}-${w}.webp`, cacheName: `${SITE_CACHE_VERSION}-${key}-${w}.webp` })),
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
        if (!(await exists(cached))) {
          const temp = `${cached}.tmp-${process.pid}-${newId()}`;
          try {
            await base.clone().resize({ width: v.w, withoutEnlargement: true }).webp({ quality: 80, effort: 4 }).toFile(temp);
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
    const main = [...p.variants].reverse().find((e) => e.w <= 960) ?? p.variants[0]!;
    variants[p.asset.id] = {
      src: `/images/${main.outName}`,
      srcset: p.variants.map((e) => `/images/${e.outName} ${e.w}w`).join(', '),
      width: main.w,
      height: main.h,
    };
  }
  await writeFile(path.join(opts.jobDir, 'images.json'), JSON.stringify(variants, null, 2));
  return { variants, skipped: skipped.sort((a, b) => a.assetId.localeCompare(b.assetId)), generated };
}
