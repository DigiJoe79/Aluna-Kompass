import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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
    const first = await prepareImageVariants({ jobDir: job, assets, cacheDir: cache });
    expect(first.A1).toEqual({
      src: '/images/abcdef123456-960.webp',
      srcset: '/images/abcdef123456-480.webp 480w, /images/abcdef123456-960.webp 960w, /images/abcdef123456-1200.webp 1200w',
      width: 960,
      height: 640,
    });
    expect(existsSync(path.join(job, 'images', 'abcdef123456-480.webp'))).toBe(true);
    expect(existsSync(path.join(job, 'images', 'abcdef123456-1600.webp'))).toBe(false); // nie hochskalieren
    expect(JSON.parse(readFileSync(path.join(job, 'images.json'), 'utf8')).A1.width).toBe(960);
    const cachedMtime = statSync(path.join(cache, 'abcdef123456-480.webp')).mtimeMs;
    const job2 = tmp();
    mkdirSync(path.join(job2, 'assets'));
    writeFileSync(path.join(job2, 'assets', 'hund-abcdef123456.png'), png);
    await prepareImageVariants({ jobDir: job2, assets, cacheDir: cache });
    expect(statSync(path.join(cache, 'abcdef123456-480.webp')).mtimeMs).toBe(cachedMtime);
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
    expect(out.S).toEqual({ src: '/images/0123456789ab.svg', srcset: '', width: 0, height: 0 });
    expect(out.P).toBeUndefined();
  });
});
