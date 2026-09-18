import { coreModule, defineModule, schema, setSetting, storeMediaAsset, unwrap, writeSettingInternal } from '@kompass/core';
import { auditEntry, createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { animalDeletionPreview, animalPhotos, animalStories, animals, animalsModule, createAnimal, deleteAnimal, setAnimalPhotos, setAnimalPublished, setAnimalStatus, setAnimalStory } from '../src';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const png = (n: number) => new Uint8Array([...PNG, ...Array(n).fill(0)]);

/** Hält jedes Tier mit Slug „gehalten“ fest und zeigt auf jedes mit Slug „verwiesen“. */
const probe = defineModule({
  key: 'probe',
  version: '0.0.0',
  permissions: [],
  retentionHolds: (deps, entityType, id) =>
    entityType === 'animal' && deps.db.select().from(animals).where(eq(animals.id, id)).get()?.slug === 'gehalten'
      ? [{ label: 'Schutzvertrag SV-2026-0007', until: '2036-12-31', entity: 'document', id: 'D1' }]
      : [],
  recordReferences: (deps, entityType, id) =>
    entityType === 'animal' && deps.db.select().from(animals).where(eq(animals.id, id)).get()?.slug === 'verwiesen'
      ? [{ label: 'Dokument „Anfrage Tierarzt“ (Entwurf)', entity: 'document', id: 'D2', href: '/dms/D2' }]
      : [],
});

const manage = ctxWith(['animals.manage', 'animals.view', 'media.upload']);
const base = { name: 'Rocky', sex: 'male' as const, birthText: { de: '' }, sizeText: { de: '' }, summary: { de: 'Kurz' }, body: { de: 'Lang' } };

async function setup() {
  const deps = createTestDeps({ manifests: [coreModule, animalsModule, probe], now: '2026-09-17T08:00:00.000Z' });
  insertUser(deps, { id: 'USER-TEST' });
  await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de'] });
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['animals', 'probe'], 'test.enable');
  });
  return deps;
}
const code = (r: { ok: boolean; error?: { type: string; code?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

describe('deleteAnimal', () => {
  it('lehnt ein veröffentlichtes Tier ab und löscht es nach dem Zurückziehen', async () => {
    const deps = await setup();
    const a = unwrap(await createAnimal(deps, manage, { ...base, slug: 'rocky' }));
    unwrap(await setAnimalPublished(deps, manage, { id: a.id, isPublished: true }));
    expect(code(await deleteAnimal(deps, manage, { id: a.id }))).toBe('stillPublished');
    expect(deps.db.select().from(animals).all()).toHaveLength(1);

    unwrap(await setAnimalPublished(deps, manage, { id: a.id, isPublished: false }));
    expect(unwrap(await deleteAnimal(deps, manage, { id: a.id }))).toEqual({ deletedMedia: [], keptMedia: [] });
    expect(deps.db.select().from(animals).all()).toEqual([]);
  });

  it('nimmt Fotos-Zuordnung und Erfolgsgeschichte mit und schreibt das volle Vorher ins Protokoll', async () => {
    const deps = await setup();
    const a = unwrap(await createAnimal(deps, manage, { ...base, slug: 'rocky' }));
    const photo = unwrap(await storeMediaAsset(deps, manage, { originalName: 'rocky.png', bytes: png(1) }));
    unwrap(await setAnimalPhotos(deps, manage, { id: a.id, photos: [{ assetId: photo.id, isPrimary: true }] }));
    unwrap(await setAnimalStatus(deps, manage, { id: a.id, status: 'adopted', adoptedYear: 2026 }));
    unwrap(await setAnimalStory(deps, manage, { id: a.id, quote: { de: 'Angekommen.' }, family: 'Familie Berger', adoptedYear: 2026, beforeAssetId: null, afterAssetId: null }));

    unwrap(await deleteAnimal(deps, manage, { id: a.id }));

    expect(deps.db.select().from(animalPhotos).all()).toEqual([]);
    expect(deps.db.select().from(animalStories).all()).toEqual([]);
    const entry = auditEntry(deps, 'animals.delete');
    expect(entry).toMatchObject({ entityType: 'animal', entityId: a.id, summary: 'Tier Rocky gelöscht' });
    const before = JSON.parse(entry.before!);
    expect(before).toMatchObject({ slug: 'rocky', name: 'Rocky', story: { family: 'Familie Berger' } });
    expect(before.photos.map((p: { assetId: string }) => p.assetId)).toEqual([photo.id]);
    // Ohne Schalter bleibt das Foto — und ist jetzt in der Mediathek frei.
    expect(deps.db.select().from(schema.mediaAssets).all().map((m) => m.id)).toEqual([photo.id]);
  });

  it('lehnt ab, solange ein Halter läuft oder ein Verweis besteht, und nennt ihn', async () => {
    const deps = await setup();
    const held = unwrap(await createAnimal(deps, manage, { ...base, slug: 'gehalten' }));
    const linked = unwrap(await createAnimal(deps, manage, { ...base, slug: 'verwiesen' }));
    const heldResult = await deleteAnimal(deps, manage, { id: held.id });
    expect(code(heldResult)).toBe('recordHeld');
    expect(heldResult.ok === false && heldResult.error.type === 'conflict' && heldResult.error.message).toContain('Schutzvertrag SV-2026-0007 (bis 2036-12-31)');
    const linkedResult = await deleteAnimal(deps, manage, { id: linked.id });
    expect(code(linkedResult)).toBe('stillReferenced');
    expect(linkedResult.ok === false && linkedResult.error.type === 'conflict' && linkedResult.error.message).toContain('Anfrage Tierarzt');
    expect(deps.db.select().from(animals).all()).toHaveLength(2);
  });

  it('räumt mit Schalter die nur hier verwendeten Fotos ab und behält geteilte', async () => {
    const deps = await setup();
    const rocky = unwrap(await createAnimal(deps, manage, { ...base, slug: 'rocky' }));
    const luna = unwrap(await createAnimal(deps, manage, { ...base, slug: 'luna', name: 'Luna' }));
    const own = unwrap(await storeMediaAsset(deps, manage, { originalName: 'rocky.png', bytes: png(1) }));
    const shared = unwrap(await storeMediaAsset(deps, manage, { originalName: 'beide.png', bytes: png(2) }));
    unwrap(await setAnimalPhotos(deps, manage, { id: rocky.id, photos: [{ assetId: own.id, isPrimary: true }, { assetId: shared.id, isPrimary: false }] }));
    unwrap(await setAnimalPhotos(deps, manage, { id: luna.id, photos: [{ assetId: shared.id, isPrimary: true }] }));

    const preview = unwrap(await animalDeletionPreview(deps, manage, rocky.id));
    expect(preview.deletable).toBe(true);
    expect(preview.media).toEqual([
      { id: own.id, filename: own.filename, usedElsewhere: [] },
      { id: shared.id, filename: shared.filename, usedElsewhere: ['Tier „Luna“'] },
    ]);

    const cleanup = unwrap(await deleteAnimal(deps, manage, { id: rocky.id, deleteOrphanedMedia: true }));
    expect(cleanup.deletedMedia).toEqual([own.id]);
    expect(cleanup.keptMedia).toEqual([{ id: shared.id, filename: shared.filename, usedBy: ['Tier „Luna“'] }]);
    expect(await deps.media.exists(own.filename)).toBe(false);
    expect(await deps.media.exists(shared.filename)).toBe(true);
    expect(auditEntry(deps, 'media.delete')).toMatchObject({ entityId: own.id });
  });

  it('verlangt animals.manage, und für den Schalter media.upload — vorher passiert nichts', async () => {
    const deps = await setup();
    const a = unwrap(await createAnimal(deps, manage, { ...base, slug: 'rocky' }));
    expect(code(await deleteAnimal(deps, ctxWith(['animals.view']), { id: a.id }))).toBe('forbidden');
    expect(code(await deleteAnimal(deps, ctxWith(['animals.manage']), { id: a.id, deleteOrphanedMedia: true }))).toBe('forbidden');
    expect(deps.db.select().from(animals).all()).toHaveLength(1);
    expect(code(await deleteAnimal(deps, manage, { id: 'MISSING' }))).toBe('notFound');
    expect(code(await animalDeletionPreview(deps, ctxWith([]), a.id))).toBe('forbidden');
  });

  it('sagt in der Vorschau dasselbe wie beim Löschen', async () => {
    const deps = await setup();
    const held = unwrap(await createAnimal(deps, manage, { ...base, slug: 'gehalten' }));
    const free = unwrap(await createAnimal(deps, manage, { ...base, slug: 'frei' }));
    expect(unwrap(await animalDeletionPreview(deps, manage, held.id)).deletable).toBe(false);
    expect((await deleteAnimal(deps, manage, { id: held.id })).ok).toBe(false);
    expect(unwrap(await animalDeletionPreview(deps, manage, free.id)).deletable).toBe(true);
    expect((await deleteAnimal(deps, manage, { id: free.id })).ok).toBe(true);
  });
});
