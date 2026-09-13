import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ensurePreview, hasPreview, previewFilename, readImageMeta, renderPreview } from '../src/media/preview';
import { deleteMediaAsset, getMediaPreview, storeMediaAsset } from '../src/media/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

/** Ein einfarbiges Bild in den gewünschten Maßen — kein Binärmaterial im Repo. */
async function png(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: '#336699' } }).png().toBuffer());
}

describe('preview naming', () => {
  it('replaces the extension with .preview.webp and knows which types get one', () => {
    expect(previewFilename('foto-0123456789ab.png')).toBe('foto-0123456789ab.preview.webp');
    expect(previewFilename('logo-0123456789ab.svg')).toBe('logo-0123456789ab.preview.webp');
    expect(hasPreview('image/jpeg')).toBe(true);
    expect(hasPreview('image/svg+xml')).toBe(false);
    expect(hasPreview('application/pdf')).toBe(false);
  });
});

describe('renderPreview', () => {
  it('scales a wide image to 320 px and keeps a small one at its size', async () => {
    const wide = await renderPreview(await png(800, 400));
    expect(await sharp(wide).metadata()).toMatchObject({ format: 'webp', width: 320, height: 160 });
    const small = await renderPreview(await png(100, 50));
    expect(await sharp(small).metadata()).toMatchObject({ width: 100, height: 50 });
  });

  it('keeps portrait portrait', async () => {
    const tall = await renderPreview(await png(400, 800));
    expect(await sharp(tall).metadata()).toMatchObject({ width: 320, height: 640 });
  });

  it('throws on bytes that are not an image', async () => {
    await expect(renderPreview(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
    await expect(readImageMeta(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });

  it('reads the dimensions', async () => {
    expect(await readImageMeta(await png(30, 20))).toEqual({ width: 30, height: 20 });
  });
});

describe('ensurePreview', () => {
  it('builds a missing preview once and reads it afterwards', async () => {
    const deps = createTestDeps();
    const original = await png(640, 320);
    await deps.media.write('bild-0123456789ab.png', original);
    const record = { filename: 'bild-0123456789ab.png', mimeType: 'image/png' };

    const first = await ensurePreview(deps, record);
    expect(first).not.toBeNull();
    expect(await deps.media.exists('bild-0123456789ab.preview.webp')).toBe(true);
    expect(await sharp(first!).metadata()).toMatchObject({ width: 320 });

    // Zweiter Aufruf liest die Datei, statt neu zu rendern: gleicher Inhalt.
    const second = await ensurePreview(deps, record);
    expect(Buffer.from(second!).equals(Buffer.from(first!))).toBe(true);
  });

  it('returns the original for SVG and null for PDF', async () => {
    const deps = createTestDeps();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
    await deps.media.write('logo-0123456789ab.svg', svg);
    const bytes = await ensurePreview(deps, { filename: 'logo-0123456789ab.svg', mimeType: 'image/svg+xml' });
    expect(Buffer.from(bytes!).equals(Buffer.from(svg))).toBe(true);
    expect(await ensurePreview(deps, { filename: 'x-0123456789ab.pdf', mimeType: 'application/pdf' })).toBeNull();
  });
});

describe('preview through the service', () => {
  it('stores the preview next to the original at upload, with rotated dimensions', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const record = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'weit.png', bytes: await png(800, 400) }));
    expect(record).toMatchObject({ width: 800, height: 400 });
    expect(await deps.media.exists(previewFilename(record.filename))).toBe(true);
  });

  it('serves the preview, rebuilds it when it was removed, refuses without a session', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const record = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'weit.png', bytes: await png(800, 400) }));
    await deps.media.delete(previewFilename(record.filename));

    const served = unwrap(await getMediaPreview(deps, ctxWith([], 'someone'), record.id));
    expect(served.contentType).toBe('image/webp');
    expect(await sharp(served.bytes!).metadata()).toMatchObject({ width: 320 });
    expect(await deps.media.exists(previewFilename(record.filename))).toBe(true);

    const anonymous = await getMediaPreview(deps, ctxWith([], null), record.id);
    expect(anonymous.ok === false && anonymous.error.type === 'unauthorized').toBe(true);
    const missing = await getMediaPreview(deps, ctx, 'NOPE');
    expect(missing.ok === false && missing.error.type === 'notFound').toBe(true);
  });

  it('answers null bytes for a PDF and the original for an SVG', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
    const logo = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'logo.svg', bytes: svg, declaredMimeType: 'image/svg+xml' }));
    const servedSvg = unwrap(await getMediaPreview(deps, ctx, logo.id));
    expect(servedSvg.contentType).toBe('image/svg+xml');
    expect(Buffer.from(servedSvg.bytes!).equals(Buffer.from(svg))).toBe(true);

    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF');
    const doc = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'doc.pdf', bytes: pdf, declaredMimeType: 'application/pdf' }));
    const servedPdf = unwrap(await getMediaPreview(deps, ctx, doc.id));
    expect(servedPdf.bytes).toBeNull();
  });

  it('deleting the asset removes original and preview', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const record = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'weg.png', bytes: await png(50, 50) }));
    unwrap(await deleteMediaAsset(deps, ctx, { id: record.id }));
    expect(await deps.media.exists(record.filename)).toBe(false);
    expect(await deps.media.exists(previewFilename(record.filename))).toBe(false);
  });
});
