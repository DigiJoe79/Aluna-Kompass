import { coreModule, schema, setSetting, storeMediaAsset, unwrap } from '@kompass/core';
import { auditEntry, createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule, createAnimal, getAnimal, listAnimals, publishedAnimals, setAnimalPhotos, setAnimalPublished, setAnimalStatus, setAnimalStory, updateAnimal } from '../src';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const deps = async () => {
  const d = createTestDeps({ manifests: [coreModule, animalsModule] });
  insertUser(d, { id: 'USER-TEST' });
  await setSetting(d, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  return d;
};
const manage = ctxWith(['animals.manage', 'animals.view', 'media.upload']);
const chiara = { name: 'Chiara', sex: 'female' as const, birthText: { de: '16.02.2021', en: '16 Feb 2021' }, sizeCm: 45, sizeText: { de: '45–50 cm', en: '45–50 cm' }, location: 'shelter' as const, isEmergency: false, isSponsorable: true, traits: { de: ['ruhig', 'verträglich'], en: ['calm', 'sociable'] }, externalProfileUrl: 'https://example.org/profile/chiara', summary: { de: 'Sanfte Hündin.', en: '' }, body: { de: 'Text', en: '' } };

describe('animals module', () => {
  it('creates tables via the core chain and registers the view', async () => {
    const d = await deps();
    const tables = (d.sqlite.prepare("select name from sqlite_master where type='table' and name like 'animal%' order by name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(['animal_origins', 'animal_photos', 'animal_proposal_images', 'animal_proposals', 'animal_stories', 'animals']);
    expect(animalsModule.publishedViews?.map((v) => v.name)).toEqual(['animals']);
  });

  it('creates an animal looking for a home, unpublished, and audits', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    expect(a).toMatchObject({ slug: expect.stringMatching(/^chiara-[0-9a-z]{4}$/), status: 'lookingForHome', isPublished: false, species: 'dog', photos: [], story: null });
    expect(d.db.select().from(schema.auditLog).all().at(-1)).toMatchObject({ action: 'animals.create', entityType: 'animal', entityId: a.id });
    // Doppelte Namen sind erlaubt; der Slug trägt die Kennung (Spec „Tier-Slug fest“, Näheres in slug-service.test.ts).
    const twin = unwrap(await createAnimal(d, manage, chiara));
    expect(twin.slug).not.toBe(a.slug);
    expect((await createAnimal(d, ctxWith(['animals.view']), { ...chiara })).ok).toBe(false);
  });

  it('manages photos with a primary image and rejects non-images', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    const p1 = unwrap(await storeMediaAsset(d, manage, { originalName: 'chiara-1.png', bytes: PNG }));
    const p2 = unwrap(await storeMediaAsset(d, manage, { originalName: 'chiara-2.png', bytes: new Uint8Array([...PNG, 0]) }));
    const pdf = unwrap(await storeMediaAsset(d, manage, { originalName: 'x.pdf', bytes: new TextEncoder().encode('%PDF-1.4\n%%EOF'), declaredMimeType: 'application/pdf' }));
    const withPhotos = unwrap(await setAnimalPhotos(d, manage, { id: a.id, photos: [{ assetId: p2.id, isPrimary: false }, { assetId: p1.id, isPrimary: true }] }));
    expect(withPhotos.photos.map((p) => [p.assetId, p.sortOrder, p.isPrimary])).toEqual([[p2.id, 1, false], [p1.id, 2, true]]);
    const photoEntry = auditEntry(d, 'animals.setPhotos');
    expect(photoEntry).toMatchObject({ entityType: 'animal', entityId: a.id });
    expect(JSON.parse(photoEntry.before!)).toEqual({ photos: [], reviewRequestedAt: null });
    expect(JSON.parse(photoEntry.after!).photos.map((p: { assetId: string }) => p.assetId)).toEqual([p2.id, p1.id]);
    const bad = await setAnimalPhotos(d, manage, { id: a.id, photos: [{ assetId: pdf.id, isPrimary: true }] });
    expect(bad.ok === false && bad.error.type === 'validation' && bad.error.issues[0]?.message === 'notAnImage').toBe(true);
    const twoPrimary = await setAnimalPhotos(d, manage, { id: a.id, photos: [{ assetId: p1.id, isPrimary: true }, { assetId: p2.id, isPrimary: true }] });
    expect(twoPrimary.ok === false && twoPrimary.error.type === 'validation').toBe(true);
  });

  it('status changes: adopted requires a year and enables the story; story rejected otherwise', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    const before = unwrap(await storeMediaAsset(d, manage, { originalName: 'vorher.png', bytes: PNG }));
    const notYet = await setAnimalStory(d, manage, { id: a.id, beforeAssetId: before.id, afterAssetId: before.id, quote: { de: 'Zitat', en: '' }, family: 'Familie M.', adoptedYear: 2026 });
    expect(notYet.ok === false && notYet.error.type === 'conflict' && notYet.error.code === 'animalNotAdopted').toBe(true);
    const missingYear = await setAnimalStatus(d, manage, { id: a.id, status: 'adopted' });
    expect(missingYear.ok === false && missingYear.error.type === 'validation').toBe(true);
    const adopted = unwrap(await setAnimalStatus(d, manage, { id: a.id, status: 'adopted', adoptedYear: 2026 }));
    expect(adopted.story).toMatchObject({ adoptedYear: 2026, family: '' });
    const statusEntry = auditEntry(d, 'animals.setStatus');
    expect(statusEntry).toMatchObject({ entityType: 'animal', entityId: a.id });
    expect(JSON.parse(statusEntry.before!)).toEqual({ status: 'lookingForHome', adoptedYear: null });
    expect(JSON.parse(statusEntry.after!)).toEqual({ status: 'adopted', adoptedYear: 2026 });
    const withStory = unwrap(await setAnimalStory(d, manage, { id: a.id, beforeAssetId: before.id, afterAssetId: before.id, quote: { de: 'Endlich zuhause.', en: 'Home at last.' }, family: 'Familie M.', adoptedYear: 2026 }));
    expect(withStory.story?.quote.en).toBe('Home at last.');
    expect(unwrap(await setAnimalStatus(d, manage, { id: a.id, status: 'reserved' })).status).toBe('reserved');
  });

  it('setting adopted with a year updates the year of an existing story and audits it', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    unwrap(await setAnimalStatus(d, manage, { id: a.id, status: 'adopted', adoptedYear: 2024 }));
    unwrap(await setAnimalStory(d, manage, { id: a.id, beforeAssetId: null, afterAssetId: null, quote: { de: 'Endlich zuhause.', en: '' }, family: 'Familie M.', adoptedYear: 2024 }));
    unwrap(await setAnimalStatus(d, manage, { id: a.id, status: 'reserved' }));
    const again = unwrap(await setAnimalStatus(d, manage, { id: a.id, status: 'adopted', adoptedYear: 2026 }));
    expect(again.story).toMatchObject({ adoptedYear: 2026, family: 'Familie M.', quote: { de: 'Endlich zuhause.' } });
    const entry = auditEntry(d, 'animals.setStatus');
    expect(JSON.parse(entry.before!)).toEqual({ status: 'reserved', adoptedYear: 2024 });
    expect(JSON.parse(entry.after!)).toEqual({ status: 'adopted', adoptedYear: 2026 });
  });

  it('publishes and exposes only published animals with photos and story in the view', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    unwrap(await createAnimal(d, manage, { ...chiara, name: 'Bruno', sex: 'male' as const, location: 'germany' as const, isEmergency: true }));
    expect(publishedAnimals.load(d)).toEqual([]);
    unwrap(await updateAnimal(d, manage, { id: a.id, summary: { de: 'Sanfte Hündin.', en: 'Gentle girl.' } }));
    unwrap(await setAnimalPublished(d, manage, { id: a.id, isPublished: true }));
    const rows = publishedAnimals.load(d);
    expect(rows.map((r) => r.slug)).toEqual([a.slug]);
    expect(rows[0]).toMatchObject({ summary: { en: 'Gentle girl.' }, photos: [], story: null });
    expect('isPublished' in rows[0]!).toBe(false);
    expect(unwrap(await listAnimals(d, ctxWith(['animals.view']))).animals).toHaveLength(2);
    expect(unwrap(await getAnimal(d, ctxWith(['animals.view']), a.id)).slug).toBe(a.slug);
  });

  it('exposes story captions in the published view', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    unwrap(await setAnimalPublished(d, manage, { id: a.id, isPublished: true }));
    unwrap(await setAnimalStatus(d, manage, { id: a.id, status: 'adopted', adoptedYear: 2026 }));
    unwrap(await setAnimalStory(d, manage, { id: a.id, beforeAssetId: null, afterAssetId: null, quote: {}, family: '', adoptedYear: 2026, beforeCaption: { de: 'Im Shelter', en: 'At the shelter' } }));
    const rows = publishedAnimals.load(d);
    expect(rows[0]!.story).toMatchObject({ beforeCaption: { de: 'Im Shelter', en: 'At the shelter' }, afterCaption: {} });
  });

  it('an update touches only the fields it names — defaults never overwrite stored values', async () => {
    // Zod 4 wendet `.default()` auch hinter `.optional()` an: Ein Update mit
    // nur `name` setzte Größe, Standort, Notfall und Patenschaft zurück.
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, { ...chiara, location: 'germany', isEmergency: true }));
    const after = unwrap(await updateAnimal(d, manage, { id: a.id, name: 'Chiara Maria' }));
    expect(after).toMatchObject({ name: 'Chiara Maria', sizeCm: 45, location: 'germany', isEmergency: true, isSponsorable: true, traits: chiara.traits, externalProfileUrl: chiara.externalProfileUrl });
  });

  it('the view tolerates traits that carry only one language, as the service accepts them', async () => {
    // Über MCP kommt ein Tier auch mit `traits: { de: [...] }` an — was der
    // Dienst annimmt, darf die Sicht beim Export nicht mit einer Exception quittieren.
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, { ...chiara, traits: { de: ['ruhig'] } }));
    unwrap(await setAnimalPublished(d, manage, { id: a.id, isPublished: true }));
    expect(publishedAnimals.load(d)[0]!.traits).toEqual({ de: ['ruhig'] });
  });

  it('stores and returns a non-localized place', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, { ...chiara, place: 'Rumänien, Brașov' }));
    expect(a.place).toBe('Rumänien, Brașov');
    const updated = unwrap(await updateAnimal(d, manage, { id: a.id, place: 'Nordrhein-Westfalen' }));
    expect(updated.place).toBe('Nordrhein-Westfalen');
  });

  it('trims and limits place to 120 characters', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, { ...chiara, place: '  Brașov  ' }));
    expect(a.place).toBe('Brașov');
    const tooLong = await createAnimal(d, manage, { ...chiara, place: 'x'.repeat(121) });
    expect(tooLong.ok === false && tooLong.error.type === 'validation').toBe(true);
  });

  it('defaults place to empty', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    expect(a.place).toBe('');
  });

  it('publishes place in the view', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, { ...chiara, place: 'Rumänien, Brașov' }));
    unwrap(await setAnimalPublished(d, manage, { id: a.id, isPublished: true }));
    expect(publishedAnimals.load(d)[0]!.place).toBe('Rumänien, Brașov');
  });

  it('a story carries captions per image, empty by default, and audits them', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    unwrap(await setAnimalStatus(d, manage, { id: a.id, status: 'adopted', adoptedYear: 2026 }));
    const bare = unwrap(await setAnimalStory(d, manage, { id: a.id, beforeAssetId: null, afterAssetId: null, quote: { de: 'Zitat', en: '' }, family: 'Familie M.', adoptedYear: 2026 }));
    expect(bare.story).toMatchObject({ beforeCaption: {}, afterCaption: {} });
    const captioned = unwrap(await setAnimalStory(d, manage, { id: a.id, beforeAssetId: null, afterAssetId: null, quote: { de: 'Zitat', en: '' }, family: 'Familie M.', adoptedYear: 2026, beforeCaption: { de: 'Auf der Pflegestelle', en: 'At the foster home' }, afterCaption: { de: 'Zuhause in Köln', en: '' } }));
    expect(captioned.story).toMatchObject({ beforeCaption: { de: 'Auf der Pflegestelle', en: 'At the foster home' }, afterCaption: { de: 'Zuhause in Köln', en: '' } });
    const entry = d.db.select().from(schema.auditLog).all().at(-1)!;
    expect(entry.action).toBe('animals.setStory');
    // `after` ist eine JSON-Textspalte (`packages/core/src/db/schema.ts`).
    expect(String(entry.after)).toContain('Auf der Pflegestelle');
    const tooLong = await setAnimalStory(d, manage, { id: a.id, beforeAssetId: null, afterAssetId: null, quote: {}, family: '', adoptedYear: 2026, beforeCaption: { de: 'x'.repeat(201) } });
    expect(tooLong.ok === false && tooLong.error.type === 'validation').toBe(true);
    const unknownLocale = await setAnimalStory(d, manage, { id: a.id, beforeAssetId: null, afterAssetId: null, quote: {}, family: '', adoptedYear: 2026, afterCaption: { fr: 'Chez nous' } });
    expect(unknownLocale.ok === false && unknownLocale.error.type === 'validation').toBe(true);
  });
});
