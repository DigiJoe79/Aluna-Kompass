import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { auditLog } from '../src/db/schema';
import { defineModule } from '../src/modules/manifest';
import { getMediaAsset, listMediaAssets, storeMediaAsset, storeMediaAssetDetailed } from '../src/media/service';
import { unwrap } from '../src/result';
import { writeSettingInternal } from '../src/settings/service';
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

  it('keeps umlauts and ß readable in the filename', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const a = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'für.png', bytes: PNG }));
    expect(a.filename).toMatch(/^fur-[0-9a-f]{12}\.png$/);
    const b = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'Straße Foto.svg', bytes: SVG, declaredMimeType: 'image/svg+xml' }));
    expect(b.filename).toMatch(/^strasse-foto-[0-9a-f]{12}\.svg$/);
  });

  it('says whether the bytes were new or already stored', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const first = unwrap(await storeMediaAssetDetailed(deps, ctx, { originalName: 'a.png', bytes: PNG }));
    expect(first.created).toBe(true);
    const second = unwrap(await storeMediaAssetDetailed(deps, ctx, { originalName: 'b.png', bytes: PNG }));
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    const denied = await storeMediaAssetDetailed(deps, ctxWith([], 'U'), { originalName: 'a.png', bytes: PNG });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
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
    const truncated = await storeMediaAsset(deps, ctx, { originalName: 't.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) });
    expect(truncated.ok === false && truncated.error.type === 'validation' && truncated.error.issues[0]?.message === 'unsupportedMediaType').toBe(true);
    expect(deps.db.select().from(auditLog).all().filter((e) => e.action === 'media.upload')).toHaveLength(0);
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

  it('filters by folder, kind and query, sorts, and reports references', async () => {
    const deps = createTestDeps({ now: '2026-09-13T10:00:00.000Z' });
    const ctx = ctxWith(['media.upload', 'settings.manage'], insertUser(deps, {}));
    const { createMediaFolder } = await import('../src/media/folders');
    const { setSetting } = await import('../src/settings/service');
    unwrap(await createMediaFolder(deps, ctx, { path: 'logos' }));
    const logo = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'Vereinslogo.png', bytes: PNG, folder: 'logos' }));
    unwrap(await setSetting(deps, ctx, { key: 'branding.logoAssetId', value: logo.id }));
    const svg = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'zeichen.svg', bytes: SVG, declaredMimeType: 'image/svg+xml' }));
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF');
    const doc = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'satzung.pdf', bytes: pdf, declaredMimeType: 'application/pdf' }));

    // Ordner
    expect(unwrap(await listMediaAssets(deps, ctx, { folder: null })).map((m) => m.record.id).sort()).toEqual([svg.id, doc.id].sort());
    const inLogos = unwrap(await listMediaAssets(deps, ctx, { folder: 'logos' }));
    expect(inLogos.map((m) => m.record.id)).toEqual([logo.id]);
    expect(inLogos[0]!.references.map((r) => r.label)).toEqual(['Logo des Vereins']);

    // Typ
    expect(unwrap(await listMediaAssets(deps, ctx, { kind: 'pdf' })).map((m) => m.record.id)).toEqual([doc.id]);
    expect(unwrap(await listMediaAssets(deps, ctx, { kind: 'image' })).map((m) => m.record.id).sort()).toEqual([logo.id, svg.id].sort());

    // Suche: Dateiname ohne Groß-/Kleinschreibung, und Verwendungs-Label
    expect(unwrap(await listMediaAssets(deps, ctx, { query: 'VEREINS' })).map((m) => m.record.id)).toEqual([logo.id]);
    expect(unwrap(await listMediaAssets(deps, ctx, { query: 'logo des' })).map((m) => m.record.id)).toEqual([logo.id]);
    expect(unwrap(await listMediaAssets(deps, ctx, { query: 'gibtsnicht' }))).toEqual([]);

    // Sortierung: alle drei haben denselben Zeitstempel (feste Uhr), deshalb Name und Größe prüfen
    expect(unwrap(await listMediaAssets(deps, ctx, { sort: 'name' })).map((m) => m.record.filename.split('-')[0])).toEqual(['satzung', 'vereinslogo', 'zeichen']);
    const bySize = unwrap(await listMediaAssets(deps, ctx, { sort: 'size' })).map((m) => m.record.bytes);
    expect(bySize).toEqual([...bySize].sort((a, b) => b - a));
  });

  it('sorts newest first by default and oldest on request', async () => {
    const deps = createTestDeps({ now: '2026-09-13T10:00:00.000Z' });
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const first = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'erst.png', bytes: PNG }));
    deps.clock.advance(60 * 60 * 1000); // TestDeps.clock ist der FixedClock aus packages/core/src/clock.ts
    const second = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'dann.svg', bytes: SVG, declaredMimeType: 'image/svg+xml' }));
    expect(unwrap(await listMediaAssets(deps, ctx)).map((m) => m.record.id)).toEqual([second.id, first.id]);
    expect(unwrap(await listMediaAssets(deps, ctx, { sort: 'oldest' })).map((m) => m.record.id)).toEqual([first.id, second.id]);
  });

  it('rejects an unknown sort or kind through the schema', async () => {
    const { mediaListFilterSchema } = await import('../src/media/service');
    expect(mediaListFilterSchema.safeParse({ sort: 'random' }).success).toBe(false);
    expect(mediaListFilterSchema.safeParse({ kind: 'video' }).success).toBe(false);
    expect(mediaListFilterSchema.safeParse({ folder: null, query: 'x', kind: 'image', sort: 'name' }).success).toBe(true);
    expect(mediaListFilterSchema.safeParse({}).success).toBe(true);
  });
});
describe('Assets unter dem Recht eines Moduls', () => {
  /** Ein Modul, das jedes Asset für sich beansprucht und unter sein Recht stellt. */
  const guarded = defineModule({
    key: 'guard',
    version: '0.0.1',
    permissions: ['guard.view'],
    mediaReferences: (_deps, assetId) => [
      { label: 'Verschlossen', entity: 'secret', id: assetId, permission: 'guard.view' },
    ],
  });

  it('liefert es nur an jemanden mit diesem Recht aus', async () => {
    const deps = createTestDeps({ manifests: [coreModule, guarded] });
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['guard'], 'test.enable');
    });
    const uploader = ctxWith(['media.upload', 'guard.view'], insertUser(deps, {}));
    const record = unwrap(await storeMediaAsset(deps, uploader, { originalName: 'a.png', bytes: PNG }));

    const allowed = await getMediaAsset(deps, ctxWith(['guard.view'], 'someone'), record.id);
    expect(allowed.ok).toBe(true);

    const denied = await getMediaAsset(deps, ctxWith(['media.upload'], 'someone'), record.id);
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.type).toBe('forbidden');
  });

  it('lässt ein Asset ohne Anspruch weiterhin für jede angemeldete Person zu', async () => {
    const deps = createTestDeps();
    const uploader = ctxWith(['media.upload'], insertUser(deps, {}));
    const record = unwrap(await storeMediaAsset(deps, uploader, { originalName: 'a.png', bytes: PNG }));
    expect((await getMediaAsset(deps, ctxWith([], 'someone'), record.id)).ok).toBe(true);
  });
});
