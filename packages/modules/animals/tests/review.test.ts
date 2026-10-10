import { coreModule, schema, setSetting, storeMediaAsset, unwrap } from '@kompass/core';
import { auditEntry, createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule, REVIEW_ON_MCP_WRITE_KEY, confirmAnimalReview, createAnimal, getAnimal, publishedAnimals, requestAnimalReview, setAnimalPhotos, setAnimalPublished, setAnimalStatus, setAnimalStory, updateAnimal } from '../src';
import { animalsSetTranslations } from '../src/translations';

/**
 * Prüfmerker (Spec 2026-09-30): Was ein Agent schreibt, ist ein Vorschlag, bis
 * ein Mensch ihn gesehen hat. Der Merker entsteht beim Schreiben über den Kanal
 * `mcp` von selbst und wird nur in der Oberfläche zurückgenommen.
 */
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const deps = async () => {
  const d = createTestDeps({ manifests: [coreModule, animalsModule] });
  insertUser(d, { id: 'USER-TEST' });
  await setSetting(d, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  // Seit 0.2.10 eine Einstellung, Vorgabe aus (Spec Vorschlags-Eingang § 4); diese Tests prüfen das Verhalten mit „an“.
  await setSetting(d, ctxWith(['settings.manage']), { key: REVIEW_ON_MCP_WRITE_KEY, value: true });
  return d;
};
const manage = ctxWith(['animals.manage', 'animals.view', 'media.upload']);
const mcp = { ...manage, channel: 'mcp' as const };
const system = { ...manage, channel: 'system' as const };
const chiara = { name: 'Chiara', sex: 'female' as const, birthText: { de: '16.02.2021', en: '16 Feb 2021' }, sizeCm: 45, sizeText: { de: '45–50 cm', en: '45–50 cm' }, location: 'shelter' as const, isEmergency: false, isSponsorable: true, traits: { de: ['ruhig', 'verträglich'], en: ['calm', 'sociable'] }, externalProfileUrl: 'https://example.org/profile/chiara', summary: { de: 'Sanfte Hündin.', en: '' }, body: { de: 'Text', en: '' } };
const story = { beforeAssetId: null, afterAssetId: null, quote: { de: 'Zitat', en: '' }, family: 'Familie M.', adoptedYear: 2026 };

describe('animal review marker', () => {
  it('with the setting off (the default), writing through mcp sets no marker; an explicit request still does', async () => {
    const d = createTestDeps({ manifests: [coreModule, animalsModule], locales: ['de', 'en'] });
    insertUser(d, { id: 'USER-TEST' });
    const a = unwrap(await createAnimal(d, mcp, chiara));
    expect(a.reviewRequestedAt).toBeNull();
    expect(unwrap(await updateAnimal(d, mcp, { id: a.id, name: 'Neu' })).reviewRequestedAt).toBeNull();
    expect(unwrap(await requestAnimalReview(d, mcp, { id: a.id, note: 'bitte ansehen' })).reviewRequestedAt).not.toBeNull();
  });

  it('a new animal carries no review marker, and the published view never shows one', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    expect(a).toMatchObject({ reviewRequestedAt: null, reviewNote: '' });
    unwrap(await setAnimalPublished(d, manage, { id: a.id, isPublished: true }));
    const row = publishedAnimals.load(d)[0]!;
    expect('reviewRequestedAt' in row).toBe(false);
    expect('reviewNote' in row).toBe(false);
  });

  it('createAnimal marks the profile through mcp, not through ui or system', async () => {
    const d = await deps();
    const viaMcp = unwrap(await createAnimal(d, mcp, chiara));
    expect(viaMcp.reviewRequestedAt).toBe(viaMcp.createdAt);
    expect(unwrap(await createAnimal(d, manage, { ...chiara })).reviewRequestedAt).toBeNull();
    expect(unwrap(await createAnimal(d, system, { ...chiara })).reviewRequestedAt).toBeNull();
  });

  it('updateAnimal, setAnimalPhotos and setAnimalStory mark through mcp and leave it alone through ui', async () => {
    const d = await deps();
    const photo = unwrap(await storeMediaAsset(d, manage, { originalName: 'p.png', bytes: PNG }));
    const writes = [
      (ctx: typeof manage, id: string) => updateAnimal(d, ctx, { id, name: 'Neu' }),
      (ctx: typeof manage, id: string) => setAnimalPhotos(d, ctx, { id, photos: [{ assetId: photo.id, isPrimary: true }] }),
      (ctx: typeof manage, id: string) => setAnimalStory(d, ctx, { id, ...story }),
    ];
    for (const [i, write] of writes.entries()) {
      const a = unwrap(await createAnimal(d, manage, { ...chiara }));
      unwrap(await setAnimalStatus(d, manage, { id: a.id, status: 'adopted', adoptedYear: 2026 }));
      expect(unwrap(await write(manage, a.id)).reviewRequestedAt).toBeNull();
      d.clock.advance(60_000);
      const marked = unwrap(await write(mcp, a.id));
      expect(marked.reviewRequestedAt).toBe(d.clock.now().toISOString());
    }
  });

  it('keeps the first time when an agent writes twice', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    d.clock.advance(60_000);
    const first = unwrap(await updateAnimal(d, mcp, { id: a.id, name: 'Eins' }));
    d.clock.advance(60_000);
    const second = unwrap(await updateAnimal(d, mcp, { id: a.id, name: 'Zwei' }));
    expect(first.reviewRequestedAt).not.toBeNull();
    expect(second.reviewRequestedAt).toBe(first.reviewRequestedAt);
    expect(second.updatedAt > first.updatedAt).toBe(true);
  });

  it('status and publication are no content: no marker through mcp', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    expect(unwrap(await setAnimalStatus(d, mcp, { id: a.id, status: 'reserved' })).reviewRequestedAt).toBeNull();
    expect(unwrap(await setAnimalPublished(d, mcp, { id: a.id, isPublished: true })).reviewRequestedAt).toBeNull();
  });

  it('the audit entry of the write carries the marker in its after state', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    unwrap(await updateAnimal(d, mcp, { id: a.id, name: 'Neu' }));
    expect(JSON.parse(auditEntry(d, 'animals.update').after!).reviewRequestedAt).toEqual(expect.any(String));
  });

  it('every marking leaves its own audit entry, once: for all four write services, not for ui, not for a second write', async () => {
    const reviewEntries = (d: Awaited<ReturnType<typeof deps>>) => d.db.select().from(schema.auditLog).all().filter((e) => e.action === 'animals.requestReview');
    const p1 = async (d: Awaited<ReturnType<typeof deps>>) => unwrap(await storeMediaAsset(d, manage, { originalName: 'a.png', bytes: PNG }));

    // createAnimal
    const d1 = await deps();
    const created = unwrap(await createAnimal(d1, mcp, chiara));
    expect(reviewEntries(d1)).toHaveLength(1);
    expect(reviewEntries(d1)[0]).toMatchObject({ entityType: 'animal', entityId: created.id, channel: 'mcp' });
    expect(JSON.parse(reviewEntries(d1)[0]!.before!)).toEqual({ reviewRequestedAt: null, reviewNote: '' });
    expect(JSON.parse(reviewEntries(d1)[0]!.after!)).toEqual({ reviewRequestedAt: created.reviewRequestedAt, reviewNote: '' });
    // Der Eintrag der Änderung selbst bleibt der letzte.
    expect(d1.db.select().from(schema.auditLog).all().at(-1)?.action).toBe('animals.create');
    // Zweites Schreiben an einem Hund, der schon wartet: kein weiterer Eintrag.
    unwrap(await updateAnimal(d1, mcp, { id: created.id, place: 'Anderswo' }));
    expect(reviewEntries(d1)).toHaveLength(1);

    // updateAnimal, setAnimalPhotos, setAnimalStory: je ein frischer Hund aus der Oberfläche.
    const d2 = await deps();
    const a = unwrap(await createAnimal(d2, manage, chiara));
    unwrap(await updateAnimal(d2, manage, { id: a.id, place: 'Hier' }));
    expect(reviewEntries(d2)).toHaveLength(0);
    unwrap(await updateAnimal(d2, mcp, { id: a.id, place: 'Dort' }));
    expect(reviewEntries(d2)).toHaveLength(1);

    const d3 = await deps();
    const b = unwrap(await createAnimal(d3, manage, chiara));
    const photo = await p1(d3);
    unwrap(await setAnimalPhotos(d3, mcp, { id: b.id, photos: [{ assetId: photo.id, isPrimary: true }] }));
    expect(reviewEntries(d3)).toHaveLength(1);
    // Spec § 5.1: Der Merker steht auch im Nachher-Stand des Eintrags der Änderung selbst.
    const photoAfter = JSON.parse(auditEntry(d3, 'animals.setPhotos').after!);
    expect(photoAfter.reviewRequestedAt).toEqual(expect.any(String));
    expect(photoAfter.photos.map((p: { assetId: string }) => p.assetId)).toEqual([photo.id]);
    expect(JSON.parse(auditEntry(d3, 'animals.setPhotos').before!)).toEqual({ photos: [], reviewRequestedAt: null });

    const d4 = await deps();
    const c = unwrap(await createAnimal(d4, manage, chiara));
    unwrap(await setAnimalStatus(d4, manage, { id: c.id, status: 'adopted', adoptedYear: 2026 }));
    unwrap(await setAnimalStory(d4, mcp, { id: c.id, ...story }));
    expect(reviewEntries(d4)).toHaveLength(1);
    expect(reviewEntries(d4)[0]?.entityId).toBe(c.id);
    const storyAfter = JSON.parse(auditEntry(d4, 'animals.setStory').after!);
    expect(storyAfter).toMatchObject({ family: story.family, reviewRequestedAt: expect.any(String) });
    expect(JSON.parse(auditEntry(d4, 'animals.setStory').before!)).toMatchObject({ reviewRequestedAt: null });
  });

  it('translations written through mcp mark the profile', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    unwrap(await animalsSetTranslations(d, mcp, { entityType: 'animal', id: a.id, items: [{ field: 'summary', locale: 'en', text: 'Gentle.' }] })!);
    expect(unwrap(await getAnimal(d, manage, a.id)).reviewRequestedAt).not.toBeNull();
    unwrap(await setAnimalStatus(d, manage, { id: a.id, status: 'adopted', adoptedYear: 2026 }));
    const b = unwrap(await createAnimal(d, manage, { ...chiara }));
    unwrap(await setAnimalStatus(d, manage, { id: b.id, status: 'adopted', adoptedYear: 2026 }));
    unwrap(await animalsSetTranslations(d, mcp, { entityType: 'animal', id: b.id, items: [{ field: 'story.quote', locale: 'en', text: 'Home.' }] })!);
    expect(unwrap(await getAnimal(d, manage, b.id)).reviewRequestedAt).not.toBeNull();
  });

  it('setAnimalPhotos moves updatedAt, also through ui', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    const photo = unwrap(await storeMediaAsset(d, manage, { originalName: 'p.png', bytes: PNG }));
    d.clock.advance(60_000);
    const after = unwrap(await setAnimalPhotos(d, manage, { id: a.id, photos: [{ assetId: photo.id, isPrimary: true }] }));
    expect(after.updatedAt > a.updatedAt).toBe(true);
  });
});

describe('requestAnimalReview', () => {
  it('sets marker and note through ui and through mcp, and audits', async () => {
    const d = await deps();
    for (const [i, ctx] of [manage, mcp].entries()) {
      const a = unwrap(await createAnimal(d, manage, { ...chiara }));
      d.clock.advance(60_000);
      const marked = unwrap(await requestAnimalReview(d, ctx, { id: a.id, note: '  neu  ' }));
      expect(marked).toMatchObject({ reviewRequestedAt: d.clock.now().toISOString(), reviewNote: 'neu', updatedAt: d.clock.now().toISOString() });
      const entry = auditEntry(d, 'animals.requestReview');
      expect(entry).toMatchObject({ entityType: 'animal', entityId: a.id });
      expect(JSON.parse(entry.before!)).toEqual({ reviewRequestedAt: null, reviewNote: '' });
      expect(JSON.parse(entry.after!)).toEqual({ reviewRequestedAt: marked.reviewRequestedAt, reviewNote: 'neu' });
    }
  });

  it('a second request replaces the note and keeps the time', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    const first = unwrap(await requestAnimalReview(d, mcp, { id: a.id, note: 'neu' }));
    d.clock.advance(60_000);
    const second = unwrap(await requestAnimalReview(d, mcp, { id: a.id, note: 'zwei neue Fotos' }));
    expect(second).toMatchObject({ reviewRequestedAt: first.reviewRequestedAt, reviewNote: 'zwei neue Fotos' });
    expect(unwrap(await requestAnimalReview(d, mcp, { id: a.id })).reviewNote).toBe('');
  });

  it('refuses without animals.manage, with a note over 500 characters, and for an unknown animal', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    expect(await requestAnimalReview(d, ctxWith(['animals.view']), { id: a.id, note: 'x' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await requestAnimalReview(d, manage, { id: a.id, note: 'x'.repeat(501) })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(unwrap(await requestAnimalReview(d, manage, { id: a.id, note: 'x'.repeat(500) })).reviewNote).toHaveLength(500);
    expect(await requestAnimalReview(d, manage, { id: 'NOPE', note: 'x' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });
});

describe('confirmAnimalReview', () => {
  const pending = async (d: Awaited<ReturnType<typeof deps>>) => {
    const a = unwrap(await createAnimal(d, manage, { ...chiara }));
    d.clock.advance(60_000);
    return unwrap(await requestAnimalReview(d, mcp, { id: a.id, note: 'neu' }));
  };
  const actions = (d: Awaited<ReturnType<typeof deps>>, id: string) => d.db.select().from(schema.auditLog).all().filter((e) => e.entityId === id).map((e) => e.action);

  it('is refused through mcp: an agent does not review its own proposal', async () => {
    const d = await deps();
    const a = await pending(d);
    expect(await confirmAnimalReview(d, mcp, { id: a.id, expectedVersion: a.updatedAt })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'reviewUiOnly' } });
    expect(unwrap(await getAnimal(d, manage, a.id)).reviewRequestedAt).toBe(a.reviewRequestedAt);
  });

  it('refuses without animals.manage, without expectedVersion and for an unknown animal', async () => {
    const d = await deps();
    const a = await pending(d);
    expect(await confirmAnimalReview(d, ctxWith(['animals.view']), { id: a.id, expectedVersion: a.updatedAt })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await confirmAnimalReview(d, manage, { id: a.id })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await confirmAnimalReview(d, manage, { id: 'NOPE', expectedVersion: a.updatedAt })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });

  it('refuses a stale version: the agent wrote after the form was loaded', async () => {
    const d = await deps();
    const loaded = await pending(d);
    d.clock.advance(60_000);
    unwrap(await updateAnimal(d, mcp, { id: loaded.id, name: 'Anders' }));
    expect(await confirmAnimalReview(d, manage, { id: loaded.id, expectedVersion: loaded.updatedAt })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'staleVersion' } });
    expect(unwrap(await getAnimal(d, manage, loaded.id)).reviewRequestedAt).not.toBeNull();
  });

  it('refuses when no review is pending', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    expect(await confirmAnimalReview(d, manage, { id: a.id, expectedVersion: a.updatedAt })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'noReviewPending' } });
  });

  it('clears marker and note, moves updatedAt and audits with the former state', async () => {
    const d = await deps();
    const a = await pending(d);
    d.clock.advance(60_000);
    const done = unwrap(await confirmAnimalReview(d, manage, { id: a.id, expectedVersion: a.updatedAt }));
    expect(done).toMatchObject({ reviewRequestedAt: null, reviewNote: '', isPublished: false, updatedAt: d.clock.now().toISOString() });
    const entry = auditEntry(d, 'animals.confirmReview');
    expect(entry).toMatchObject({ entityType: 'animal', entityId: a.id });
    expect(JSON.parse(entry.before!)).toEqual({ reviewRequestedAt: a.reviewRequestedAt, reviewNote: 'neu' });
    expect(actions(d, a.id)).not.toContain('animals.publish');
  });

  it('with publish it also publishes an unpublished animal, with its own audit entry', async () => {
    const d = await deps();
    const a = await pending(d);
    const done = unwrap(await confirmAnimalReview(d, manage, { id: a.id, expectedVersion: a.updatedAt, publish: true }));
    expect(done).toMatchObject({ reviewRequestedAt: null, isPublished: true });
    expect(actions(d, a.id).slice(-2)).toEqual(['animals.confirmReview', 'animals.publish']);
    expect(JSON.parse(auditEntry(d, 'animals.publish').after!)).toEqual({ isPublished: true });
  });

  it('with publish on an already published animal there is no publish entry', async () => {
    const d = await deps();
    const a = await pending(d);
    const published = unwrap(await setAnimalPublished(d, manage, { id: a.id, isPublished: true }));
    const before = actions(d, a.id).filter((x) => x === 'animals.publish').length;
    unwrap(await confirmAnimalReview(d, manage, { id: a.id, expectedVersion: published.updatedAt, publish: true }));
    expect(actions(d, a.id).filter((x) => x === 'animals.publish')).toHaveLength(before);
  });
});

describe('publishedAnimals.pendingReview', () => {
  it('names published animals that wait for a review, and nothing else', async () => {
    const d = await deps();
    const live = unwrap(await createAnimal(d, manage, chiara));
    unwrap(await setAnimalPublished(d, manage, { id: live.id, isPublished: true }));
    const draft = unwrap(await createAnimal(d, manage, { ...chiara, name: 'Pelle' }));
    expect(publishedAnimals.pendingReview!(d)).toEqual([]);
    const marked = unwrap(await requestAnimalReview(d, mcp, { id: live.id, note: 'Text geändert' }));
    // Ein unveröffentlichter Hund geht nicht live: Er gehört in die Arbeitsliste, nicht in die Warnung.
    unwrap(await requestAnimalReview(d, mcp, { id: draft.id, note: 'neu' }));
    expect(publishedAnimals.pendingReview!(d)).toEqual([{ label: 'Chiara', href: `/animals/${live.id}` }]);
    unwrap(await confirmAnimalReview(d, manage, { id: live.id, expectedVersion: marked.updatedAt }));
    expect(publishedAnimals.pendingReview!(d)).toEqual([]);
  });
});

describe('publishedAnimals.editLink', () => {
  it('leads from a view row to the edit page, titled with the name', async () => {
    const d = await deps();
    const live = unwrap(await createAnimal(d, manage, chiara));
    unwrap(await setAnimalPublished(d, manage, { id: live.id, isPublished: true }));
    const [row] = publishedAnimals.load(d);
    expect(publishedAnimals.editLink!(d, row!)).toEqual({ href: `/animals/${live.id}`, title: 'Chiara' });
    expect(publishedAnimals.editLink!(d, { ...row!, slug: 'gibt-es-nicht' })).toBeNull();
  });
});
