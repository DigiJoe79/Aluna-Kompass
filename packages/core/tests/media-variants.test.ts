import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ensureImageVariant, IMAGE_VARIANTS, renderImageVariant, variantFilename } from '../src/media/variants';
import { deleteMediaAsset, storeMediaAsset } from '../src/media/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

async function png(width: number, height: number, alpha = false): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 0, g: 0, b: 0, alpha: 0 } : '#336699' } }).png().toBuffer());
}

describe('image variants', () => {
  it('names a variant next to the original as JPEG', () => {
    expect(variantFilename('foto-0123456789ab.png', 'print')).toBe('foto-0123456789ab.print.jpg');
    expect(variantFilename('foto-0123456789ab.webp', 'printThumb')).toBe('foto-0123456789ab.print-thumb.jpg');
  });

  it('scales to the variant width as JPEG, keeps small images small, flattens transparency to white', async () => {
    expect(IMAGE_VARIANTS.print.width).toBe(1200);
    expect(IMAGE_VARIANTS.printThumb.width).toBe(400);
    expect(await sharp(await renderImageVariant(await png(2400, 3000), 'print')).metadata()).toMatchObject({ format: 'jpeg', width: 1200, height: 1500 });
    expect(await sharp(await renderImageVariant(await png(300, 200), 'print')).metadata()).toMatchObject({ width: 300, height: 200 });
    const flat = await sharp(await renderImageVariant(await png(10, 10, true), 'printThumb')).raw().toBuffer();
    expect([flat[0], flat[1], flat[2]]).toEqual([255, 255, 255]);
  });

  it('turns by EXIF like the browser', async () => {
    const turned = new Uint8Array(await sharp({ create: { width: 800, height: 400, channels: 3, background: '#336699' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer());
    expect(await sharp(await renderImageVariant(turned, 'printThumb')).metadata()).toMatchObject({ width: 400, height: 800 });
  });

  it('builds once on demand, reads afterwards, and is null for SVG and PDF', async () => {
    const deps = createTestDeps();
    await deps.media.write('bild-0123456789ab.png', await png(1600, 2000));
    const record = { filename: 'bild-0123456789ab.png', mimeType: 'image/png' };
    const first = await ensureImageVariant(deps, record, 'print');
    expect(first).toMatchObject({ width: 1200, height: 1500 });
    expect(await deps.media.exists('bild-0123456789ab.print.jpg')).toBe(true);
    const second = await ensureImageVariant(deps, record, 'print');
    expect(Buffer.from(second!.bytes).equals(Buffer.from(first!.bytes))).toBe(true);
    expect(await ensureImageVariant(deps, { filename: 'x-0123456789ab.svg', mimeType: 'image/svg+xml' }, 'print')).toBeNull();
    expect(await ensureImageVariant(deps, { filename: 'x-0123456789ab.pdf', mimeType: 'application/pdf' }, 'print')).toBeNull();
  });

  it('is never built at upload, and goes with the asset when it is deleted', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const record = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'hund.png', bytes: await png(800, 1000) }));
    expect(await deps.media.exists(variantFilename(record.filename, 'print'))).toBe(false);
    await ensureImageVariant(deps, record, 'print');
    await ensureImageVariant(deps, record, 'printThumb');
    unwrap(await deleteMediaAsset(deps, ctx, { id: record.id }));
    expect(await deps.media.exists(variantFilename(record.filename, 'print'))).toBe(false);
    expect(await deps.media.exists(variantFilename(record.filename, 'printThumb'))).toBe(false);
  });
});
