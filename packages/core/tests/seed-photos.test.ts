import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { resolveSeedAssetsDir, SEED_PHOTOS } from '../src/seed/photos';

describe('seed photos (Joe, 2026-10-06)', () => {
  it('ships exactly the 19 agreed files', () => {
    expect(readdirSync(resolveSeedAssetsDir({})).filter((f) => f.endsWith('.jpg')).sort()).toEqual(SEED_PHOTOS.map((p) => p.file).sort());
    expect(SEED_PHOTOS).toHaveLength(19);
  });

  it.each(SEED_PHOTOS.map((p) => [p.file, p] as const))('%s is a valid JPEG in the agreed format, at most 300 KB', async (file, photo) => {
    const full = path.join(resolveSeedAssetsDir({}), file);
    expect(statSync(full).size).toBeLessThanOrEqual(300 * 1024);
    const bytes = readFileSync(full);
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe('jpeg');
    const ratio = meta.width! / meta.height!;
    expect(Math.abs(ratio - photo.ratio), `${meta.width}×${meta.height}`).toBeLessThan(0.02);
  });

  it('reads the directory from KOMPASS_SEED_ASSETS_DIR in the container', () => {
    expect(resolveSeedAssetsDir({ KOMPASS_SEED_ASSETS_DIR: '/app/packages/core/src/seed/assets' })).toBe('/app/packages/core/src/seed/assets');
  });
});
