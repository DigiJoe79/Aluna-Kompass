import { coreModule, parseDerivedAssetId, readSetting, seedDevelopment, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule } from '../src/manifest';
import { eq } from 'drizzle-orm';
import { animalPhotos, animalProposals, animalStories, animals } from '../src/schema';
import { getProposal, listProposals, PROPOSALS_ENABLED_KEY, publishedAnimals, resolveDelistedNotice } from '../src';

describe('animals seed', () => {
  it('seeds a few example animals with a mix of statuses and one published', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const rows = deps.db.select().from(animals).all();
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(new Set(rows.map((a) => a.status)).size).toBeGreaterThan(1);
    expect(rows.some((a) => a.isPublished)).toBe(true);
  });

  it('gives a published animal a photo with a crop, so the website export cuts one (Spec Bildausschnitt § 2)', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const cropped = deps.db.select({ animalId: animalPhotos.animalId, crop: animalPhotos.crop }).from(animalPhotos).all().filter((p) => p.crop !== null);
    const published = new Set(deps.db.select().from(animals).all().filter((a) => a.isPublished).map((a) => a.id));
    expect(cropped.some((p) => published.has(p.animalId))).toBe(true);
    // Die veröffentlichte Sicht trägt dafür die abgeleitete ID.
    const ids = publishedAnimals.load(deps).flatMap((a) => (a as { photos: { assetId: string }[] }).photos.map((p) => p.assetId));
    expect(ids.some((id) => parseDerivedAssetId(id) !== null)).toBe(true);
  });

  it('seeds two adopted animals with a story: one captioned, one without captions', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const stories = deps.db.select().from(animalStories).all();
    expect(stories.length).toBe(2);
    expect(stories.some((s) => Object.values(s.beforeCaption).some((v) => v.length > 0))).toBe(true);
    expect(stories.some((s) => Object.keys(s.beforeCaption).length === 0 && Object.keys(s.afterCaption).length === 0)).toBe(true);
  });

  it('gives each example animal a place: shelter animals abroad, foster animals a German state', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const rows = deps.db.select().from(animals).all();
    for (const a of rows) expect(a.place.length).toBeGreaterThan(0);
    const placesOf = (location: string) => new Set(rows.filter((a) => a.location === location).map((a) => a.place));
    expect(placesOf('shelter').size).toBeGreaterThan(0);
    expect(placesOf('germany').size).toBeGreaterThan(0);
    expect([...placesOf('shelter')].filter((place) => placesOf('germany').has(place))).toEqual([]);
  });

  it('leaves one animal untranslated so translations_list_gaps has something to show', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const rows = deps.db.select().from(animals).all();
    // `noUncheckedIndexedAccess` macht Record-Zugriffe optional — Helfer statt Cast-Wiederholung.
    const locale = (summary: unknown, code: string): string => (summary as Record<string, string | undefined>)[code] ?? '';
    const gap = rows.filter((a) => locale(a.summary, 'de').length > 0 && locale(a.summary, 'en').length === 0);
    expect(gap.length).toBeGreaterThanOrEqual(1);
    expect(rows.filter((a) => locale(a.summary, 'en').length > 0).length).toBeGreaterThanOrEqual(2);
  });

  it('seeds two animals waiting for review: one new and unpublished, one published and changed, both with photos', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const pending = deps.db.select().from(animals).all().filter((a) => a.reviewRequestedAt !== null);
    expect(pending.some((a) => !a.isPublished && a.reviewNote)).toBe(true);
    expect(pending.some((a) => a.isPublished && a.reviewNote)).toBe(true);
    for (const a of pending) expect(deps.db.select().from(animalPhotos).where(eq(animalPhotos.animalId, a.id)).all().length).toBeGreaterThanOrEqual(2);
  });

  it('gives the two waiting animals different review times, so the queue order does not depend on the name', async () => {
    // Die Testuhr steht still: Ohne eigenen Abstand bekämen beide denselben Zeitpunkt.
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const at = deps.db.select().from(animals).all().flatMap((a) => (a.reviewRequestedAt ? [a.reviewRequestedAt] : []));
    expect(at.length).toBeGreaterThanOrEqual(2);
    expect(new Set(at).size).toBe(at.length);
  });

  it('sets an invented profile address and gives one published dog a long, multi-paragraph text', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const { readSetting } = await import('@kompass/core');
    expect(readSetting<string>(deps, 'animals.profileUrl')).toMatch(/^https:\/\/.+\{slug\}/);
    const long = deps.db.select().from(animals).all().filter((a) => {
      const body = (a.body as Record<string, string>).de ?? '';
      return a.isPublished && body.split(/\n\s*\n/).length >= 8 && body.length > 3000;
    });
    expect(long.length).toBeGreaterThanOrEqual(1);
  });

  it('gives every example animal its own pictures from the core media seed, one story a before and an after picture (Spec 2026-10-06 § 4)', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const rows = deps.db.select().from(animals).all();
    const count = rows.map((a) => deps.db.select().from(animalPhotos).where(eq(animalPhotos.animalId, a.id)).all().length);
    expect(count.every((n) => n >= 1)).toBe(true);
    expect(count.some((n) => n >= 2)).toBe(true);
    const assetIds = deps.db.select().from(animalPhotos).all().map((p) => p.assetId);
    expect(new Set(assetIds).size).toBe(assetIds.length);
    // Eine Geschichte mit Vorher- und Nachher-Bild; Ausschnitt für alle Bilder § 3: ein Bild mit Ausschnitt, eins ohne.
    const stories = deps.db.select().from(animalStories).all();
    expect(stories.some((s) => s.beforeAssetId && s.afterAssetId && s.beforeAssetId !== s.afterAssetId && s.beforeCrop !== null && s.afterCrop === null)).toBe(true);
  });

  it('seeds proposals of every kind from an invented source, open and decided', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const rows = deps.db.select().from(animalProposals).all();
    expect(new Set(rows.filter((r) => r.state === 'open').map((r) => r.kind))).toEqual(new Set(['create', 'update', 'notice', 'sameAs']));
    expect(rows.some((r) => r.state === 'accepted' || r.state === 'acceptedWithChanges')).toBe(true);
    expect(rows.some((r) => r.state === 'rejected')).toBe(true);
    expect(rows.some((r) => r.state === 'withdrawn')).toBe(true);
    // Ein offener Hinweis „nicht mehr gelistet“, den man auf Dev erledigen kann (Vermittelt · offline · erledigt).
    const delisted = rows.find((r) => r.state === 'open' && r.kind === 'notice' && r.noticeKind === 'delisted');
    expect(delisted).toBeDefined();
    expect(readSetting(deps, PROPOSALS_ENABLED_KEY)).toBe(true);
    const list = unwrap(await listProposals(deps, ctxWith(['animals.manage'])));
    expect(list.open.withConflict).toBeGreaterThanOrEqual(1);
    expect(list.proposals.some((p) => p.kind === 'create' && p.missing.length > 0)).toBe(true);
    expect(list.proposals.some((p) => p.hintCount > 0)).toBe(true);
    // Für den Stapel (Plan B): eine Änderung und ein neuer Hund, die rechts mit einem Wisch durchgehen.
    expect(list.proposals.some((p) => p.kind === 'update' && p.conflictCount === 0 && p.hintCount === 0)).toBe(true);
    expect(list.proposals.some((p) => p.kind === 'create' && p.missing.length === 0 && p.hintCount === 0)).toBe(true);
    expect(unwrap(await resolveDelistedNotice(deps, ctxWith(['animals.manage']), { id: delisted!.id })).proposal.state).toBe('accepted');
  });

  /** Backlog 79: Die Wahl „Heute behalten / Wechseln“ erscheint nur, wenn eine Änderung ein anderes Titelbild vorschlägt. */
  it('seeds an open change that proposes another primary photo, so the review offers the primary choice', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const ctx = ctxWith(['animals.manage']);
    const open = deps.db.select().from(animalProposals).all().filter((r) => r.state === 'open' && r.kind === 'update');
    const reviews = await Promise.all(open.map(async (r) => unwrap(await getProposal(deps, ctx, r.id))));
    const switching = reviews.filter((r) => {
      const photos = r.photos ?? [];
      const proposed = photos.find((p) => p.proposedPrimary);
      const current = photos.find((p) => p.currentPrimary);
      return proposed && current && proposed.key !== current.key;
    });
    expect(switching).toHaveLength(1);
  });

  it('seeds an open change to a long text, so the review shows a word diff with a few changed places', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const long = deps.db
      .select()
      .from(animalProposals)
      .all()
      .find((r) => r.state === 'open' && r.kind === 'update' && (r.values as { body?: unknown } | null)?.body !== undefined);
    expect(long).toBeDefined();
    const values = long!.values as { body: Record<string, string>; birthText?: Record<string, string> };
    const animal = deps.db.select().from(animals).where(eq(animals.id, long!.animalId!)).get()!;
    const current = animal.body as Record<string, string>;
    for (const locale of ['de', 'en']) {
      // Lang genug für den Wortunterschied (Gegenüberstellung: ab 200 Zeichen), mehrere Absätze, aber nur stellenweise anders.
      expect(current[locale]!.length).toBeGreaterThan(200);
      expect(current[locale]).toContain('\n\n');
      expect(values.body[locale]).not.toBe(current[locale]);
      const before = new Set(current[locale]!.split(/\s+/));
      const after = values.body[locale]!.split(/\s+/);
      const changed = after.filter((w) => !before.has(w)).length;
      expect(changed).toBeGreaterThan(1);
      expect(changed).toBeLessThan(after.length / 5);
    }
    expect(values.birthText).toBeDefined();
    const hints = long!.hints as { title?: string; field?: string }[];
    expect(hints.some((h) => h.title !== undefined && h.field !== undefined)).toBe(true);
  });
});
