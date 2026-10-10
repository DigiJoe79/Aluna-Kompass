import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { inspectRasterImage } from '../src';

describe('inspectRasterImage', () => {
  it('reads type, size and checksum of jpeg, png and webp', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const bytes = new Uint8Array(await sharp({ create: { width: 4, height: 5, channels: 3, background: '#336699' } })[format]().toBuffer());
      expect(await inspectRasterImage(bytes)).toMatchObject({ mimeType: `image/${format}`, width: 4, height: 5, bytes: bytes.byteLength, checksum: expect.stringMatching(/^[0-9a-f]{64}$/) });
    }
  });
  it('refuses svg, pdf and garbage', async () => {
    expect(await inspectRasterImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(await inspectRasterImage(new TextEncoder().encode('%PDF-1.7\n'))).toBeNull();
    expect(await inspectRasterImage(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
