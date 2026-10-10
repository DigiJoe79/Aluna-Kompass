import { storeMediaAsset, unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { getAnimal, publishedAnimals, replacePhotosTx, setAnimalPhotos, setAnimalPublished } from '../src';
import { animal, manager, png, proposalDeps, SOURCE_A } from './proposal-fixture';

describe('photo crop and source', () => {
  it('stores a crop through setAnimalPhotos and refuses one outside the picture', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const m = unwrap(await storeMediaAsset(d, manager, { originalName: 'a.png', bytes: await png(1) }));
    const crop = { x: 0.1, y: 0, w: 0.8, h: 1 };
    expect(unwrap(await setAnimalPhotos(d, manager, { id: a.id, photos: [{ assetId: m.id, isPrimary: true, crop }] })).photos[0]).toMatchObject({ crop, sourceUserId: null, sourceRef: null });
    expect((await setAnimalPhotos(d, manager, { id: a.id, photos: [{ assetId: m.id, crop: { x: 0.5, y: 0, w: 0.6, h: 1 } }] })).ok).toBe(false);
  });

  it('keeps crop and source when the photo list is saved without them; crop: null removes the crop', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const m1 = unwrap(await storeMediaAsset(d, manager, { originalName: 'a.png', bytes: await png(1) }));
    const m2 = unwrap(await storeMediaAsset(d, manager, { originalName: 'b.png', bytes: await png(2) }));
    const before = unwrap(await getAnimal(d, manager, a.id));
    d.db.transaction((tx) => replacePhotosTx(tx, d, manager, before, [{ assetId: m1.id, isPrimary: true, crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, source: { userId: SOURCE_A, ref: 'hb-1' } }]));
    // So speichert die heutige Fotomaske: nur assetId und isPrimary, Reihenfolge getauscht, ein Foto dazu.
    const saved = unwrap(await setAnimalPhotos(d, manager, { id: a.id, photos: [{ assetId: m2.id, isPrimary: false }, { assetId: m1.id, isPrimary: true }] }));
    expect(saved.photos.find((p) => p.assetId === m1.id)).toMatchObject({ crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, sourceUserId: SOURCE_A, sourceRef: 'hb-1' });
    expect(saved.photos.find((p) => p.assetId === m2.id)).toMatchObject({ crop: null, sourceUserId: null });
    const cleared = unwrap(await setAnimalPhotos(d, manager, { id: a.id, photos: [{ assetId: m1.id, isPrimary: true, crop: null }] }));
    expect(cleared.photos[0]).toMatchObject({ crop: null, sourceUserId: SOURCE_A });
  });

  it('published view carries only assetId, sortOrder and isPrimary per photo', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const m = unwrap(await storeMediaAsset(d, manager, { originalName: 'a.png', bytes: await png(1) }));
    const before = unwrap(await getAnimal(d, manager, a.id));
    d.db.transaction((tx) => replacePhotosTx(tx, d, manager, before, [{ assetId: m.id, isPrimary: true, crop: { x: 0, y: 0, w: 1, h: 1 }, source: { userId: SOURCE_A, ref: 'hb-1' } }]));
    unwrap(await setAnimalPublished(d, manager, { id: a.id, isPublished: true }));
    expect(Object.keys((publishedAnimals.load(d)[0] as { photos: object[] }).photos[0]!).sort()).toEqual(['assetId', 'isPrimary', 'sortOrder']);
  });
});
