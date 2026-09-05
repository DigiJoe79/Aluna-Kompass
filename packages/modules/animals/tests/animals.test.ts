import { coreModule, schema, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule, createAnimal, getAnimal, listAnimals, publishedAnimals, setAnimalPhotos, setAnimalPublished, setAnimalStatus, setAnimalStory, updateAnimal } from '../src';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const deps = () => { const d = createTestDeps({ manifests: [coreModule, animalsModule] }); insertUser(d, { id: 'USER-TEST' }); return d; };
const manage = ctxWith(['animals.manage', 'animals.view', 'media.upload']);
const chiara = { slug: 'chiara', name: 'Chiara', sex: 'female' as const, birthText: { de: '16.02.2021', en: '16 Feb 2021' }, sizeCm: 45, sizeText: { de: '45–50 cm', en: '45–50 cm' }, location: 'shelter' as const, isEmergency: false, isSponsorable: true, traits: { de: ['ruhig', 'verträglich'], en: ['calm', 'sociable'] }, externalProfileUrl: 'https://www.hundeblicke.net/chiara', summary: { de: 'Sanfte Hündin.', en: '' }, body: { de: 'Text', en: '' } };

describe('animals module', () => {
  it('creates tables via the core chain and registers the view', () => {
    const d = deps();
    const tables = (d.sqlite.prepare("select name from sqlite_master where type='table' and name like 'animal%' order by name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(['animal_photos', 'animal_stories', 'animals']);
    expect(animalsModule.publishedViews?.map((v) => v.name)).toEqual(['animals']);
  });

  it('creates an animal looking for a home, unpublished, and audits', async () => {
    const d = deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    expect(a).toMatchObject({ slug: 'chiara', status: 'lookingForHome', isPublished: false, species: 'dog', photos: [], story: null });
    expect(d.db.select().from(schema.auditLog).all().at(-1)).toMatchObject({ action: 'animals.create', entityType: 'animal', entityId: a.id });
    const dup = await createAnimal(d, manage, chiara);
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'slugTaken').toBe(true);
    expect((await createAnimal(d, ctxWith(['animals.view']), { ...chiara, slug: 'x' })).ok).toBe(false);
  });

  it('manages photos with a primary image and rejects non-images', async () => {
    const d = deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    const p1 = unwrap(await storeMediaAsset(d, manage, { originalName: 'chiara-1.png', bytes: PNG }));
    const p2 = unwrap(await storeMediaAsset(d, manage, { originalName: 'chiara-2.png', bytes: new Uint8Array([...PNG, 0]) }));
    const pdf = unwrap(await storeMediaAsset(d, manage, { originalName: 'x.pdf', bytes: new TextEncoder().encode('%PDF-1.4\n%%EOF'), declaredMimeType: 'application/pdf' }));
    const withPhotos = unwrap(await setAnimalPhotos(d, manage, { id: a.id, photos: [{ assetId: p2.id, isPrimary: false }, { assetId: p1.id, isPrimary: true }] }));
    expect(withPhotos.photos.map((p) => [p.assetId, p.sortOrder, p.isPrimary])).toEqual([[p2.id, 1, false], [p1.id, 2, true]]);
    const bad = await setAnimalPhotos(d, manage, { id: a.id, photos: [{ assetId: pdf.id, isPrimary: true }] });
    expect(bad.ok === false && bad.error.type === 'validation' && bad.error.issues[0]?.message === 'notAnImage').toBe(true);
    const twoPrimary = await setAnimalPhotos(d, manage, { id: a.id, photos: [{ assetId: p1.id, isPrimary: true }, { assetId: p2.id, isPrimary: true }] });
    expect(twoPrimary.ok === false && twoPrimary.error.type === 'validation').toBe(true);
  });

  it('status changes: adopted requires a year and enables the story; story rejected otherwise', async () => {
    const d = deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    const before = unwrap(await storeMediaAsset(d, manage, { originalName: 'vorher.png', bytes: PNG }));
    const notYet = await setAnimalStory(d, manage, { id: a.id, beforeAssetId: before.id, afterAssetId: before.id, quote: { de: 'Zitat', en: '' }, family: 'Familie M.', adoptedYear: 2026 });
    expect(notYet.ok === false && notYet.error.type === 'conflict' && notYet.error.code === 'animalNotAdopted').toBe(true);
    const missingYear = await setAnimalStatus(d, manage, { id: a.id, status: 'adopted' });
    expect(missingYear.ok === false && missingYear.error.type === 'validation').toBe(true);
    const adopted = unwrap(await setAnimalStatus(d, manage, { id: a.id, status: 'adopted', adoptedYear: 2026 }));
    expect(adopted.story).toMatchObject({ adoptedYear: 2026, family: '' });
    const withStory = unwrap(await setAnimalStory(d, manage, { id: a.id, beforeAssetId: before.id, afterAssetId: before.id, quote: { de: 'Endlich zuhause.', en: 'Home at last.' }, family: 'Familie M.', adoptedYear: 2026 }));
    expect(withStory.story?.quote.en).toBe('Home at last.');
    expect(unwrap(await setAnimalStatus(d, manage, { id: a.id, status: 'reserved' })).status).toBe('reserved');
  });

  it('publishes and exposes only published animals with photos and story in the view', async () => {
    const d = deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    unwrap(await createAnimal(d, manage, { ...chiara, slug: 'bruno', name: 'Bruno', sex: 'male' as const, location: 'germany' as const, isEmergency: true }));
    expect(publishedAnimals.load(d)).toEqual([]);
    unwrap(await updateAnimal(d, manage, { id: a.id, summary: { de: 'Sanfte Hündin.', en: 'Gentle girl.' } }));
    unwrap(await setAnimalPublished(d, manage, { id: a.id, isPublished: true }));
    const rows = publishedAnimals.load(d);
    expect(rows.map((r) => r.slug)).toEqual(['chiara']);
    expect(rows[0]).toMatchObject({ summary: { en: 'Gentle girl.' }, photos: [], story: null });
    expect('isPublished' in rows[0]!).toBe(false);
    expect(unwrap(await listAnimals(d, ctxWith(['animals.view'])))).toHaveLength(2);
    expect(unwrap(await getAnimal(d, ctxWith(['animals.view']), a.id)).slug).toBe('chiara');
  });
});
