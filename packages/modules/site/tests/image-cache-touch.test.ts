import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Das Anfassen eines Cache-Treffers darf scheitern (fremder Besitzer im Volume, parallel gefegt): höchstens früher gefegt. */
const touch = vi.hoisted(() => ({ fail: false }));
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>();
  return { ...real, utimes: (async (...args: Parameters<typeof real.utimes>) => (touch.fail ? Promise.reject(Object.assign(new Error('EPERM'), { code: 'EPERM' })) : real.utimes(...args))) as typeof real.utimes };
});
import { prepareImageVariants } from '../src/pipeline/images';

const dirs: string[] = [];
afterEach(() => {
  touch.fail = false;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-touch-'));
  dirs.push(d);
  return d;
};

describe('prepareImageVariants, cache hit', () => {
  it('goes on when the time stamp of a cached variant cannot be renewed', async () => {
    const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#336699' } }).png().toBuffer();
    const assets = [{ id: 'A1', filename: 'hund-abcdef123456.png', mimeType: 'image/png', width: 600, height: 400 }];
    const job = () => {
      const d = tmp();
      mkdirSync(path.join(d, 'assets'));
      writeFileSync(path.join(d, 'assets', assets[0]!.filename), png);
      return d;
    };
    const cache = tmp();
    await prepareImageVariants({ jobDir: job(), assets, cacheDir: cache });
    touch.fail = true;
    const again = await prepareImageVariants({ jobDir: job(), assets, cacheDir: cache });
    expect(again.generated).toBe(0);
    expect(again.variants.A1).toBeDefined();
  });
});
