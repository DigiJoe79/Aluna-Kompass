import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { auditLog } from '../src/db/schema';
import { getMediaAsset, listMediaAssets, storeMediaAsset } from '../src/media/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

// 1×1 PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');

describe('media service', () => {
  it('stores a PNG with sniffed type, dimensions, hashed filename and audit entry', async () => {
    const deps = createTestDeps();
    const userId = insertUser(deps, {});
    const record = unwrap(await storeMediaAsset(deps, ctxWith(['media.upload'], userId), { originalName: 'Vereins Logo.PNG', bytes: PNG, declaredMimeType: 'application/octet-stream' }));
    expect(record).toMatchObject({ mimeType: 'image/png', bytes: PNG.byteLength, width: 1, height: 1, uploadedByUserId: userId });
    expect(record.filename).toMatch(/^vereins-logo-[0-9a-f]{12}\.png$/);
    expect(await deps.media.exists(record.filename)).toBe(true);
    expect(deps.db.select().from(auditLog).all().at(-1)).toMatchObject({ action: 'media.upload', entityType: 'mediaAsset', entityId: record.id });
  });

  it('speichert die vollständige SHA-256 der Datei', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const stored = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'bild.png', bytes: PNG, declaredMimeType: 'image/png' }));
    const expected = createHash('sha256').update(PNG).digest('hex');
    expect(stored.checksum).toBe(expected);
    expect(stored.checksum).toHaveLength(64);
  });

  it('deduplicates identical content and accepts safe SVG', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const a = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG }));
    const b = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'b.png', bytes: PNG }));
    expect(b.id).toBe(a.id);
    const svg = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'logo.svg', bytes: SVG, declaredMimeType: 'image/svg+xml' }));
    expect(svg.mimeType).toBe('image/svg+xml');
  });

  it('rejects unsupported types, scripts in SVG, oversized files and missing permission', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const badExe = await storeMediaAsset(deps, ctx, { originalName: 'x.exe', bytes: new Uint8Array([0x4d, 0x5a, 0, 0]) });
    expect(badExe.ok === false && badExe.error.type === 'validation' && badExe.error.issues[0]?.message === 'unsupportedMediaType').toBe(true);
    const evil = await storeMediaAsset(deps, ctx, { originalName: 'e.svg', bytes: new TextEncoder().encode('<svg><script>alert(1)</script></svg>'), declaredMimeType: 'image/svg+xml' });
    expect(evil.ok === false && evil.error.type === 'validation' && evil.error.issues[0]?.message === 'svgContainsScript').toBe(true);
    const big = await storeMediaAsset(deps, ctx, { originalName: 'big.png', bytes: new Uint8Array(10 * 1024 * 1024 + 1) });
    expect(big.ok === false && big.error.type === 'validation' && big.error.issues[0]?.message === 'fileTooLarge').toBe(true);
    const noPerm = await storeMediaAsset(deps, ctxWith([], 'U'), { originalName: 'a.png', bytes: PNG });
    expect(noPerm.ok === false && noPerm.error.type === 'forbidden').toBe(true);
  });

  it('reads assets back for any authenticated user and lists them for uploaders', async () => {
    const deps = createTestDeps();
    const uploader = ctxWith(['media.upload'], insertUser(deps, {}));
    const record = unwrap(await storeMediaAsset(deps, uploader, { originalName: 'a.png', bytes: PNG }));
    const read = unwrap(await getMediaAsset(deps, ctxWith([], 'someone'), record.id));
    expect(Buffer.from(read.bytes).equals(Buffer.from(PNG))).toBe(true);
    const listed = unwrap(await listMediaAssets(deps, uploader));
    expect(listed.map((m) => m.record.id)).toEqual([record.id]);
    expect(listed[0]!.references).toEqual([]);
    expect((await getMediaAsset(deps, ctxWith([], null), record.id)).ok).toBe(false);
  });

  it('filters by folder and reports references', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload', 'settings.manage'], insertUser(deps, {}));
    const { createMediaFolder } = await import('../src/media/folders');
    const { setSetting } = await import('../src/settings/service');
    unwrap(await createMediaFolder(deps, ctx, { path: 'logos' }));
    const a = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG, folder: 'logos' }));
    unwrap(await setSetting(deps, ctx, { key: 'branding.logoAssetId', value: a.id }));

    expect(unwrap(await listMediaAssets(deps, ctx, null))).toEqual([]);
    const inLogos = unwrap(await listMediaAssets(deps, ctx, 'logos'));
    expect(inLogos[0]!.references.map((r) => r.label)).toEqual(['Logo des Vereins']);
  });
});