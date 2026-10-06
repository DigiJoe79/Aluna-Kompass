import { coreModule, setSetting, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule, createAnimal, listAnimals, requestAnimalReview, setAnimalPhotos, setAnimalPublished, setAnimalStatus } from '../src';

/**
 * Die Liste trägt einige hundert Tiere (Spec 2026-09-30, § 5.4): knappe Zeilen
 * ohne Texte, gefiltert und sortiert im Dienst, Zähler ungefiltert.
 */
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const manage = ctxWith(['animals.manage', 'animals.view', 'media.upload']);
const view = ctxWith(['animals.view']);
const base = { sex: 'female' as const, birthText: { de: '2021', en: '' }, sizeText: { de: '45 cm', en: '' }, summary: { de: 'Kurztext', en: '' }, body: { de: 'Langer Text', en: '' }, traits: { de: ['ruhig'], en: [] } };

/** Vier Tiere, in dieser Reihenfolge angelegt, je eine Minute auseinander: Bärbel, anton, Zora, Milo. */
const setup = async () => {
  const d = createTestDeps({ manifests: [coreModule, animalsModule] });
  insertUser(d, { id: 'USER-TEST' });
  await setSetting(d, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  const baerbel = unwrap(await createAnimal(d, manage, { ...base, name: 'Bärbel', location: 'germany', place: 'Hessen', isSponsorable: true }));
  unwrap(await setAnimalStatus(d, manage, { id: baerbel.id, status: 'reserved' }));
  unwrap(await setAnimalPublished(d, manage, { id: baerbel.id, isPublished: true }));
  const p1 = unwrap(await storeMediaAsset(d, manage, { originalName: 'eins.png', bytes: PNG }));
  const p2 = unwrap(await storeMediaAsset(d, manage, { originalName: 'zwei.png', bytes: new Uint8Array([...PNG, 0]) }));
  unwrap(await setAnimalPhotos(d, manage, { id: baerbel.id, photos: [{ assetId: p1.id, isPrimary: false }, { assetId: p2.id, isPrimary: true }] }));
  d.clock.advance(60_000);
  const anton = unwrap(await createAnimal(d, manage, { ...base, name: 'anton', sex: 'male' }));
  unwrap(await requestAnimalReview(d, manage, { id: anton.id, note: 'neu' }));
  d.clock.advance(60_000);
  const zora = unwrap(await createAnimal(d, manage, { ...base, name: 'Zora' }));
  unwrap(await setAnimalStatus(d, manage, { id: zora.id, status: 'adopted', adoptedYear: 2026 }));
  unwrap(await setAnimalPublished(d, manage, { id: zora.id, isPublished: true }));
  d.clock.advance(60_000);
  const milo = unwrap(await createAnimal(d, manage, { ...base, name: 'Milo', sex: 'male' }));
  return { d, baerbel, anton, zora, milo, primaryAssetId: p2.id };
};
const names = async (d: Awaited<ReturnType<typeof setup>>['d'], input?: unknown) => unwrap(await listAnimals(d, view, input)).animals.map((a) => a.name);

describe('listAnimals', () => {
  it('without input lists all by name, ignoring case, with unfiltered counters', async () => {
    const { d } = await setup();
    const list = unwrap(await listAnimals(d, view));
    expect(list.animals.map((a) => a.name)).toEqual(['anton', 'Bärbel', 'Milo', 'Zora']);
    expect(list).toMatchObject({ total: 4, reviewPending: 1 });
  });

  it('returns short rows: no texts, photos or story, but photo count and primary photo', async () => {
    const { d, primaryAssetId } = await setup();
    const rows = unwrap(await listAnimals(d, view)).animals;
    const baerbel = rows.find((a) => a.name === 'Bärbel')!;
    expect(Object.keys(baerbel).sort()).toEqual(['createdAt', 'externalProfileUrl', 'id', 'isEmergency', 'isPublished', 'isSponsorable', 'location', 'name', 'photoCount', 'place', 'primaryAssetId', 'reviewNote', 'reviewRequestedAt', 'sex', 'slug', 'status', 'updatedAt']);
    expect(baerbel).toMatchObject({ slug: expect.stringMatching(/^baerbel-[0-9a-z]{4}$/), sex: 'female', status: 'reserved', location: 'germany', place: 'Hessen', isSponsorable: true, isPublished: true, reviewRequestedAt: null, reviewNote: '', photoCount: 2, primaryAssetId });
    expect(rows.find((a) => a.name === 'Milo')).toMatchObject({ photoCount: 0, primaryAssetId: null });
    expect(rows.find((a) => a.name === 'anton')).toMatchObject({ reviewNote: 'neu', reviewRequestedAt: expect.any(String) });
  });

  it('filters by text in name or slug, with umlauts and without case', async () => {
    const { d, milo } = await setup();
    expect(await names(d, { text: 'bär' })).toEqual(['Bärbel']);
    expect(await names(d, { text: 'BÄR' })).toEqual(['Bärbel']);
    expect(await names(d, { text: 'ANT' })).toEqual(['anton']);
    expect(await names(d, { text: milo.slug })).toEqual(['Milo']);
    expect(await names(d, { text: 'gibtsnicht' })).toEqual([]);
    expect(await names(d, { text: '  ' })).toHaveLength(4);
  });

  it('filters by status, location, publication and review marker', async () => {
    const { d } = await setup();
    expect(await names(d, { status: 'adopted' })).toEqual(['Zora']);
    expect(await names(d, { location: 'germany' })).toEqual(['Bärbel']);
    expect(await names(d, { isPublished: true })).toEqual(['Bärbel', 'Zora']);
    expect(await names(d, { isPublished: false })).toEqual(['anton', 'Milo']);
    expect(await names(d, { reviewPending: true })).toEqual(['anton']);
    expect(await names(d, { reviewPending: false })).toEqual(['Bärbel', 'Milo', 'Zora']);
    expect(await names(d, { location: 'shelter', isPublished: false, text: 'o' })).toEqual(['anton', 'Milo']);
  });

  it('keeps the counters unfiltered', async () => {
    const { d } = await setup();
    for (const input of [{ text: 'bär' }, { status: 'adopted' }, { location: 'germany' }, { isPublished: true }, { reviewPending: false }, { text: 'gibtsnicht' }]) {
      expect(unwrap(await listAnimals(d, view, input))).toMatchObject({ total: 4, reviewPending: 1 });
    }
  });

  it('sorts by the chosen field, ties and missing values fall back to the name', async () => {
    const { d, milo, zora } = await setup();
    expect(await names(d, { orderBy: { field: 'name', direction: 'desc' } })).toEqual(['Zora', 'Milo', 'Bärbel', 'anton']);
    expect(await names(d, { orderBy: { field: 'createdAt' } })).toEqual(['Bärbel', 'anton', 'Zora', 'Milo']);
    expect(await names(d, { orderBy: { field: 'updatedAt', direction: 'desc' } })).toEqual(['Milo', 'Zora', 'anton', 'Bärbel']);
    // Nur anton wartet; die übrigen haben keinen Zeitpunkt und stehen am Ende, nach Name.
    expect(await names(d, { orderBy: { field: 'reviewRequestedAt', direction: 'asc' } })).toEqual(['anton', 'Bärbel', 'Milo', 'Zora']);
    // Gleichstand: Zora und Milo bekommen denselben Zeitpunkt, Milo steht nach Name vorn — auch absteigend.
    d.clock.advance(60_000);
    unwrap(await requestAnimalReview(d, manage, { id: zora.id, note: '' }));
    unwrap(await requestAnimalReview(d, manage, { id: milo.id, note: '' }));
    expect(await names(d, { orderBy: { field: 'reviewRequestedAt', direction: 'asc' } })).toEqual(['anton', 'Milo', 'Zora', 'Bärbel']);
    expect(await names(d, { orderBy: { field: 'reviewRequestedAt', direction: 'desc' } })).toEqual(['Milo', 'Zora', 'anton', 'Bärbel']);
  });

  it('refuses without animals.view and rejects an unknown status', async () => {
    const { d } = await setup();
    expect(await listAnimals(d, ctxWith([]))).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await listAnimals(d, view, { status: 'x' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('an empty installation lists nothing', async () => {
    const d = createTestDeps({ manifests: [coreModule, animalsModule] });
    expect(unwrap(await listAnimals(d, view))).toEqual({ animals: [], total: 0, reviewPending: 0 });
  });
});
