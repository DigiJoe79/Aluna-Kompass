import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExportedAsset } from '../src/export';
import { IMAGE_WIDTHS, prepareImageVariants } from '../src/pipeline/images';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-crop-'));
  dirs.push(d);
  return d;
};

/** Linke Hälfte rot, rechte blau. */
async function halves(width: number, height: number, orientation?: number): Promise<Buffer> {
  const half = await sharp({ create: { width: width / 2, height, channels: 3, background: '#0000ff' } }).png().toBuffer();
  const img = sharp({ create: { width, height, channels: 3, background: '#ff0000' } }).composite([{ input: half, left: width / 2, top: 0 }]);
  return orientation ? img.jpeg({ quality: 95 }).withMetadata({ orientation }).toBuffer() : img.png().toBuffer();
}

/** Mittlere Farbe einer Variante: rot, blau oder gemischt. */
async function colour(file: string): Promise<'red' | 'blue' | 'mixed'> {
  const { channels } = await sharp(readFileSync(file)).stats();
  const [r, , b] = channels.map((c) => c.mean);
  if (r! > 200 && b! < 50) return 'red';
  if (b! > 200 && r! < 50) return 'blue';
  return 'mixed';
}

const job = (file: string, bytes: Buffer) => {
  const dir = tmp();
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'assets', file), bytes);
  return dir;
};

/** Spec Bildausschnitt § 2: Die Pipeline schneidet nach der EXIF-Drehung zu und legt die Varianten unter der abgeleiteten ID ab. */
describe('prepareImageVariants with a crop', () => {
  const FILE = 'hund-abcdef123456.png';
  const right: ExportedAsset = { id: 'A1~5000_0_5000_10000', filename: FILE, mimeType: 'image/png', width: 1000, height: 1000, crop: { x: 0.5, y: 0, w: 0.5, h: 1 } };
  const plain: ExportedAsset = { id: 'A1', filename: FILE, mimeType: 'image/png', width: 2000, height: 1000 };

  it('cuts the right half: only blue, widths up to the width of the cut, keyed by the derived ID', async () => {
    const dir = job(FILE, await halves(2000, 1000));
    const cache = tmp();
    const out = await prepareImageVariants({ jobDir: dir, assets: [right, plain], cacheDir: cache });
    const cut = out.variants[right.id]!;
    expect(cut).toEqual({
      src: '/images/abcdef123456-5000_0_5000_10000-960.webp',
      srcset: [480, 960, 1000].map((w) => `/images/abcdef123456-5000_0_5000_10000-${w}.webp ${w}w`).join(', '),
      width: 960,
      height: 960,
    });
    expect(IMAGE_WIDTHS.filter((w) => w > 1000).every((w) => !cut.srcset.includes(`-${w}.webp`))).toBe(true);
    for (const w of [480, 960, 1000]) expect(await colour(path.join(dir, 'images', `abcdef123456-5000_0_5000_10000-${w}.webp`))).toBe('blue');
    // Dasselbe Original ohne Ausschnitt daneben: eigene, ungeschnittene Varianten.
    expect(out.variants.A1!.srcset).toContain('/images/abcdef123456-1600.webp 1600w');
    expect(await colour(path.join(dir, 'images', 'abcdef123456-960.webp'))).toBe('mixed');
    const json = JSON.parse(readFileSync(path.join(dir, 'images.json'), 'utf8'));
    expect(Object.keys(json).sort()).toEqual(['A1', 'A1~5000_0_5000_10000']);
    expect(readdirSync(cache).filter((n) => n.includes('5000_0_5000_10000'))).toHaveLength(3);
  });

  it('cuts in the turned picture when the original carries EXIF orientation 6', async () => {
    // Gespeichert 200×100 (links rot, rechts blau), angezeigt 100×200: oben rot, unten blau.
    const FILE6 = 'turned-0123456789ab.jpg';
    const dir = job(FILE6, await halves(200, 100, 6));
    const lower: ExportedAsset = { id: 'T~0_5000_10000_5000', filename: FILE6, mimeType: 'image/jpeg', width: 100, height: 100, crop: { x: 0, y: 0.5, w: 1, h: 0.5 } };
    const out = await prepareImageVariants({ jobDir: dir, assets: [lower], cacheDir: tmp() });
    expect(out.variants[lower.id]).toMatchObject({ width: 100, height: 100 });
    expect(await colour(path.join(dir, 'images', '0123456789ab-0_5000_10000_5000-100.webp'))).toBe('blue');
  });

  it('gives a turned picture without a crop its turned size (0.2.11 Nr. 5)', async () => {
    // Gespeichert 200×100, angezeigt 100×200: Breiten und Maße nach der Drehung, sonst steht in images.json 200×100.
    const FILE6 = 'turned-0123456789ab.jpg';
    const dir = job(FILE6, await halves(200, 100, 6));
    const whole: ExportedAsset = { id: 'T', filename: FILE6, mimeType: 'image/jpeg', width: 100, height: 200 };
    const out = await prepareImageVariants({ jobDir: dir, assets: [whole], cacheDir: tmp() });
    expect(out.variants.T).toEqual({ src: '/images/0123456789ab-100.webp', srcset: '/images/0123456789ab-100.webp 100w', width: 100, height: 200 });
    expect((await sharp(readFileSync(path.join(dir, 'images', '0123456789ab-100.webp'))).metadata()).height).toBe(200);
  });

  it('makes new variants for another crop and hits the cache for the same one', async () => {
    const bytes = await halves(2000, 1000);
    const cache = tmp();
    const first = await prepareImageVariants({ jobDir: job(FILE, bytes), assets: [right], cacheDir: cache });
    expect(first.generated).toBe(3);
    const same = await prepareImageVariants({ jobDir: job(FILE, bytes), assets: [right], cacheDir: cache });
    expect(same.generated).toBe(0);
    const left: ExportedAsset = { ...right, id: 'A1~0_0_5000_10000', crop: { x: 0, y: 0, w: 0.5, h: 1 } };
    const dir = job(FILE, bytes);
    const other = await prepareImageVariants({ jobDir: dir, assets: [left], cacheDir: cache });
    expect(other.generated).toBe(3);
    expect(await colour(path.join(dir, 'images', 'abcdef123456-0_0_5000_10000-480.webp'))).toBe('red');
  });

  it('clamps a crop that reaches past the picture to at least one pixel inside', async () => {
    const dir = job(FILE, await halves(200, 100));
    const edge: ExportedAsset = { id: 'E~9999_0_1_10000', filename: FILE, mimeType: 'image/png', width: 1, height: 100, crop: { x: 0.9999, y: 0, w: 0.0001, h: 1 } };
    const out = await prepareImageVariants({ jobDir: dir, assets: [edge], cacheDir: tmp() });
    expect(out.skipped).toEqual([]);
    expect(out.variants[edge.id]).toMatchObject({ width: 1, height: 100 });
  });
});
