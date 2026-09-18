import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { ExportedAsset } from '../export';

export const IMAGE_WIDTHS = [480, 960, 1600] as const;
export interface ImageVariant {
  src: string;
  srcset: string;
  width: number;
  height: number;
}

const RASTER = new Set(['image/png', 'image/jpeg', 'image/webp']);
const hashOf = (filename: string): string =>
  /-([0-9a-f]{12})\.[a-z0-9]+$/i.exec(filename)?.[1] ?? filename.replace(/\.[^.]+$/, '');
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false
  );

export async function prepareImageVariants(opts: {
  jobDir: string;
  assets: ExportedAsset[];
  cacheDir: string;
}): Promise<Record<string, ImageVariant>> {
  const outDir = path.join(opts.jobDir, 'images');
  await mkdir(outDir, { recursive: true });
  await mkdir(opts.cacheDir, { recursive: true });
  const result: Record<string, ImageVariant> = {};
  for (const asset of [...opts.assets].sort((a, b) => a.id.localeCompare(b.id))) {
    const source = path.join(opts.jobDir, 'assets', asset.filename);
    const hash = hashOf(asset.filename);
    if (asset.mimeType === 'image/svg+xml') {
      await copyFile(source, path.join(outDir, `${hash}.svg`));
      result[asset.id] = { src: `/images/${hash}.svg`, srcset: '', width: 0, height: 0 };
      continue;
    }
    if (!RASTER.has(asset.mimeType)) continue;
    const input = await readFile(source);
    const meta = await sharp(input).metadata();
    const originalWidth = meta.width ?? 0;
    const originalHeight = meta.height ?? 0;
    const widths = [...new Set([...IMAGE_WIDTHS.filter((w) => w < originalWidth), originalWidth])].sort((a, b) => a - b);
    const entries: { w: number; h: number; file: string }[] = [];
    for (const w of widths) {
      const file = `${hash}-${w}.webp`;
      const cached = path.join(opts.cacheDir, file);
      if (!(await exists(cached))) {
        await sharp(input).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80, effort: 4 }).toFile(cached);
      }
      await copyFile(cached, path.join(outDir, file));
      entries.push({ w, h: Math.round((originalHeight * w) / originalWidth), file });
    }
    const main = [...entries].reverse().find((e) => e.w <= 960) ?? entries[0]!;
    result[asset.id] = {
      src: `/images/${main.file}`,
      srcset: entries.map((e) => `/images/${e.file} ${e.w}w`).join(', '),
      width: main.w,
      height: main.h,
    };
  }
  await writeFile(path.join(opts.jobDir, 'images.json'), JSON.stringify(result, null, 2));
  return result;
}
