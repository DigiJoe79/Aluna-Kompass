import { describe, expect, it } from 'vitest';
import { auditLog } from '../src/db/schema';
import { setSetting } from '../src/settings/service';
import { deleteMediaAsset, storeMediaAsset } from '../src/media/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);

describe('deleteMediaAsset', () => {
  it('removes an unreferenced asset, its file and writes an audit entry', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const asset = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG }));

    unwrap(await deleteMediaAsset(deps, ctx, { id: asset.id }));

    expect(deps.db.select().from(auditLog).all().at(-1)).toMatchObject({
      action: 'media.delete',
      entityType: 'mediaAsset',
      entityId: asset.id,
    });
    expect(await deps.media.exists(asset.filename)).toBe(false);
    expect((await deleteMediaAsset(deps, ctx, { id: asset.id })).ok).toBe(false); // jetzt weg
  });

  it('refuses without the permission', async () => {
    const deps = createTestDeps();
    const owner = ctxWith(['media.upload'], insertUser(deps, {}));
    const asset = unwrap(await storeMediaAsset(deps, owner, { originalName: 'a.png', bytes: PNG }));
    const res = await deleteMediaAsset(deps, ctxWith([], 'U'), { id: asset.id });
    expect(res.ok === false && res.error.type === 'forbidden').toBe(true);
  });

  it('rejects a missing id and an unknown asset', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    expect((await deleteMediaAsset(deps, ctx, {})).ok).toBe(false);
    const res = await deleteMediaAsset(deps, ctx, { id: 'MISSING' });
    expect(res.ok === false && res.error.type === 'notFound').toBe(true);
  });

  it('refuses while the asset is the club logo and names the reference', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload', 'settings.manage'], insertUser(deps, {}));
    const asset = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'logo.png', bytes: PNG }));
    unwrap(await setSetting(deps, ctx, { key: 'branding.logoAssetId', value: asset.id }));

    const res = await deleteMediaAsset(deps, ctx, { id: asset.id });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unexpected');
    expect(res.error.type).toBe('conflict');
    if (res.error.type !== 'conflict') throw new Error('unexpected');
    expect(res.error.code).toBe('mediaAssetInUse');
    expect(res.error.message).toContain('Logo des Vereins');
    expect(await deps.media.exists(asset.filename)).toBe(true); // nichts angefasst
  });
});
