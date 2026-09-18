import { coreModule, deleteMediaAsset, setModuleEnabled, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { animalsModule, createAnimal, setAnimalPhotos } from '@kompass/module-animals';
import { siteModule } from '@kompass/module-site';
import { describe, expect, it } from 'vitest';

const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);

describe('media delete across modules', () => {
  it('is blocked by an animal photo when the animals module is enabled', async () => {
    const deps = createTestDeps({ manifests: [coreModule, siteModule, animalsModule], locales: ['de'] });
    const userId = insertUser(deps, {});
    unwrap(await setModuleEnabled(deps, ctxWith(['modules.manage'], userId), { key: 'animals', enabled: true }));

    const ctx = ctxWith(['media.upload', 'animals.manage'], userId);
    const photo = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'r.png', bytes: PNG }));
    const animal = unwrap(await createAnimal(deps, ctx, { slug: 'rex', name: 'Rex', sex: 'male', birthText: {}, sizeText: {}, summary: {}, body: {} }));
    unwrap(await setAnimalPhotos(deps, ctx, { id: animal.id, photos: [{ assetId: photo.id, isPrimary: true }] }));

    const res = await deleteMediaAsset(deps, ctx, { id: photo.id });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unexpected');
    expect(res.error.type).toBe('conflict');
    if (res.error.type !== 'conflict') throw new Error('unexpected');
    expect(res.error.code).toBe('mediaAssetInUse');
    expect(res.error.message).toContain('Tier „Rex“');
  });
});
