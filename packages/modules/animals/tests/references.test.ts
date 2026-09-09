import { coreModule, setSetting, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule, createAnimal, setAnimalPhotos } from '../src';
import { animalsMediaReferences } from '../src/references';

const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);

const setup = async () => {
  const d = createTestDeps({ manifests: [coreModule, animalsModule] });
  insertUser(d, { id: 'USER-TEST' });
  await setSetting(d, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de'] });
  return d;
};

const base = { birthText: {}, sizeText: {}, summary: {}, body: {} };

describe('animalsMediaReferences', () => {
  it('names the animal that uses a photo, and nothing for an unrelated asset', async () => {
    const d = await setup();
    const ctx = ctxWith(['media.upload', 'animals.manage']);
    const photo = unwrap(await storeMediaAsset(d, ctx, { originalName: 'rocky.png', bytes: PNG }));
    const animal = unwrap(await createAnimal(d, ctx, { slug: 'rocky', name: 'Rocky', sex: 'male', ...base }));
    unwrap(await setAnimalPhotos(d, ctx, { id: animal.id, photos: [{ assetId: photo.id, isPrimary: true }] }));

    expect(animalsMediaReferences(d, photo.id)).toEqual([{ label: 'Tier „Rocky"', entity: 'animal', id: animal.id }]);
    expect(animalsMediaReferences(d, 'OTHER')).toEqual([]);
  });
});
