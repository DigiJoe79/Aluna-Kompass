import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareImageVariants } from '../src/pipeline/images';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-img-'));
  dirs.push(d);
  return d;
};

describe('prepareImageVariants', () => {
  it('creates capped webp variants, an images.json and reuses the cache', async () => {
    const job = tmp();
    const cache = tmp();
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(path.join(job, 'assets'));
    const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#336699' } }).png().toBuffer();
    writeFileSync(path.join(job, 'assets', 'hund-abcdef123456.png'), png);
    const assets = [{ id: 'A1', filename: 'hund-abcdef123456.png', mimeType: 'image/png', width: 1200, height: 800 }];
    const cacheName = `v1-${createHash('sha256').update(png).digest('hex').slice(0, 16)}-480.webp`;
    const first = await prepareImageVariants({ jobDir: job, assets, cacheDir: cache });
    expect(first.variants.A1).toEqual({
      src: '/images/abcdef123456-960.webp',
      srcset: '/images/abcdef123456-480.webp 480w, /images/abcdef123456-960.webp 960w, /images/abcdef123456-1200.webp 1200w',
      width: 960,
      height: 640,
    });
    expect(existsSync(path.join(job, 'images', 'abcdef123456-480.webp'))).toBe(true);
    expect(existsSync(path.join(job, 'images', 'abcdef123456-1600.webp'))).toBe(false); // nie hochskalieren
    expect(JSON.parse(readFileSync(path.join(job, 'images.json'), 'utf8')).A1.width).toBe(960);
    const cachedMtime = statSync(path.join(cache, cacheName)).mtimeMs;
    const job2 = tmp();
    mkdirSync(path.join(job2, 'assets'));
    writeFileSync(path.join(job2, 'assets', 'hund-abcdef123456.png'), png);
    await prepareImageVariants({ jobDir: job2, assets, cacheDir: cache });
    expect(statSync(path.join(cache, cacheName)).mtimeMs).toBe(cachedMtime);
    expect(readFileSync(path.join(job2, 'images', 'abcdef123456-480.webp')).equals(readFileSync(path.join(job, 'images', 'abcdef123456-480.webp')))).toBe(true);
  });

  it('copies svg unchanged and skips non-images', async () => {
    const job = tmp();
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(path.join(job, 'assets'));
    writeFileSync(path.join(job, 'assets', 'logo-0123456789ab.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(path.join(job, 'assets', 'antrag-fedcba987654.pdf'), '%PDF-');
    const out = await prepareImageVariants({
      jobDir: job,
      assets: [
        { id: 'S', filename: 'logo-0123456789ab.svg', mimeType: 'image/svg+xml', width: null, height: null },
        { id: 'P', filename: 'antrag-fedcba987654.pdf', mimeType: 'application/pdf', width: null, height: null },
      ],
      cacheDir: tmp(),
    });
    expect(out.variants.S).toEqual({ src: '/images/0123456789ab.svg', srcset: '', width: 0, height: 0 });
    expect(out.variants.P).toBeUndefined();
  });

  const png = (color: string) => sharp({ create: { width: 1200, height: 800, channels: 3, background: color } }).png().toBuffer();
  const jobWith = (name: string, bytes: Buffer | string) => {
    const job = tmp();
    mkdirSync(path.join(job, 'assets'));
    writeFileSync(path.join(job, 'assets', name), bytes);
    return job;
  };
  const hund = { id: 'A1', filename: 'hund-abcdef123456.png', mimeType: 'image/png', width: 1200, height: 800 };

  it('skips a broken image by name and finishes the others', async () => {
    const job = jobWith('hund-abcdef123456.png', await png('#336699'));
    writeFileSync(path.join(job, 'assets', 'kaputt-0123456789ab.png'), 'kein png');
    const out = await prepareImageVariants({
      jobDir: job,
      assets: [hund, { id: 'B', filename: 'kaputt-0123456789ab.png', mimeType: 'image/png', width: 800, height: 600 }],
      cacheDir: tmp(),
    });
    expect(out.skipped).toEqual([{ assetId: 'B', filename: 'kaputt-0123456789ab.png', reason: 'decodeFailed' }]);
    expect(out.variants.A1).toBeDefined();
    expect(out.variants.B).toBeUndefined();
  });

  it('makes new variants when the same file name gets new content', async () => {
    const cache = tmp();
    const first = jobWith('hund-abcdef123456.png', await png('#336699'));
    await prepareImageVariants({ jobDir: first, assets: [hund], cacheDir: cache });
    const second = jobWith('hund-abcdef123456.png', await png('#aa3333'));
    const out = await prepareImageVariants({ jobDir: second, assets: [hund], cacheDir: cache });
    expect(out.generated).toBe(3);
    expect(readFileSync(path.join(second, 'images', 'abcdef123456-480.webp')).equals(readFileSync(path.join(first, 'images', 'abcdef123456-480.webp')))).toBe(false);
  });

  it('never uses a half written cache file and drops other versions', async () => {
    const bytes = await png('#336699');
    const key = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const cache = tmp();
    writeFileSync(path.join(cache, 'abcdef123456-480.webp'), 'alt'); // Fassung 0.2.4
    writeFileSync(path.join(cache, `v1-${key}-480.webp.tmp-999`), 'abgeschnitten'); // Rest eines Abbruchs
    const job = jobWith('hund-abcdef123456.png', bytes);
    const out = await prepareImageVariants({ jobDir: job, assets: [hund], cacheDir: cache });
    expect(readdirSync(cache).every((f) => f.startsWith('v1-') && f.endsWith('.webp'))).toBe(true);
    expect((await sharp(path.join(job, 'images', 'abcdef123456-480.webp')).metadata()).width).toBe(480);
    expect(out.generated).toBe(3);
  });

  it('reports plan and progress, and stops between images on abort', async () => {
    const bytes = await png('#336699');
    const cache = tmp();
    const plans: unknown[] = [];
    const progress: number[][] = [];
    const job = jobWith('hund-abcdef123456.png', bytes);
    await prepareImageVariants({ jobDir: job, assets: [hund], cacheDir: cache, onPlan: (p) => plans.push(p), onProgress: (d, t, g) => progress.push([d, t, g]) });
    expect(plans).toEqual([{ total: 3, missing: 3 }]);
    expect(progress.at(-1)).toEqual([3, 3, 3]);
    const again = await prepareImageVariants({ jobDir: jobWith('hund-abcdef123456.png', bytes), assets: [hund], cacheDir: cache });
    expect(again.generated).toBe(0);
    const ctl = new AbortController();
    ctl.abort(new Error('weg'));
    const job2 = jobWith('hund-abcdef123456.png', bytes);
    await expect(prepareImageVariants({ jobDir: job2, assets: [hund], cacheDir: tmp(), signal: ctl.signal })).rejects.toThrow('weg');
    expect(readdirSync(path.join(job2, 'images'))).toEqual([]);
  });
});
