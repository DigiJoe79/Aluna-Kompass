import { coreModule, readSetting, seedDevelopment, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule } from '../src/manifest';
import { eq } from 'drizzle-orm';
import { animalPhotos, animalProposals, animalStories, animals } from '../src/schema';
import { listProposals, PROPOSALS_ENABLED_KEY } from '../src';

describe('animals seed', () => {
  it('seeds a few example animals with a mix of statuses and one published', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const rows = deps.db.select().from(animals).all();
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(new Set(rows.map((a) => a.status)).size).toBeGreaterThan(1);
    expect(rows.some((a) => a.isPublished)).toBe(true);
  });

  it('is idempotent', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const first = deps.db.select().from(animals).all().length;
    await seedDevelopment(deps);
    expect(deps.db.select().from(animals).all().length).toBe(first);
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
    const byName = Object.fromEntries(rows.map((a) => [a.name, a.place]));
    expect(byName.Baxter).toBe('Rumänien, Ploiești');
    expect(byName.Frida).toBe('Nordrhein-Westfalen');
    expect(byName.Nala).toBe('Rumänien, Cluj-Napoca');
    expect(byName.Juno).toBe('Baden-Württemberg');
    expect(byName.Pelle).toBe('Rumänien, Brașov');
    expect(byName.Mika).toBe('Niedersachsen');
  });

  it('leaves one animal untranslated so translations_list_gaps has something to show', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const rows = deps.db.select().from(animals).all();
    // `noUncheckedIndexedAccess` macht Record-Zugriffe optional — Helfer statt Cast-Wiederholung.
    const locale = (summary: unknown, code: string): string => (summary as Record<string, string | undefined>)[code] ?? '';
    const gap = rows.filter((a) => locale(a.summary, 'de').length > 0 && locale(a.summary, 'en').length === 0);
    expect(gap.map((a) => a.name)).toEqual(['Frida']);
    expect(rows.filter((a) => locale(a.summary, 'en').length > 0).length).toBeGreaterThanOrEqual(2);
  });

  it('seeds two animals waiting for review: one new and unpublished, one published and changed, both with photos', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const pending = deps.db.select().from(animals).all().filter((a) => a.reviewRequestedAt !== null);
    expect(pending.map((a) => [a.name, a.isPublished, a.reviewNote]).sort()).toEqual([['Mika', true, 'Text und Fotos geändert'], ['Pelle', false, 'neu']]);
    for (const a of pending) expect(deps.db.select().from(animalPhotos).where(eq(animalPhotos.animalId, a.id)).all().length).toBeGreaterThanOrEqual(2);
  });

  it('gives the two waiting animals different review times, so the queue order does not depend on the name', async () => {
    // Die Testuhr steht still: Ohne eigenen Abstand bekämen beide denselben Zeitpunkt.
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const at = Object.fromEntries(deps.db.select().from(animals).all().map((a) => [a.name, a.reviewRequestedAt]));
    expect(at.Pelle! < at.Mika!).toBe(true);
  });

  it('sets an invented profile address and gives one published dog a long, multi-paragraph text', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const { readSetting } = await import('@kompass/core');
    expect(readSetting<string>(deps, 'animals.profileUrl')).toBe('https://musterverein.example/tiere/{slug}/');
    const mika = deps.db.select().from(animals).where(eq(animals.name, 'Mika')).get()!;
    expect(mika.isPublished).toBe(true);
    const body = (mika.body as Record<string, string>).de!;
    expect(body.split(/\n\s*\n/).length).toBeGreaterThanOrEqual(8);
    expect(body.length).toBeGreaterThan(3000);
  });

  it('gives every example animal its own pictures from the core media seed, Nala a before and an after picture (Spec 2026-10-06 § 4)', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const rows = deps.db.select().from(animals).all();
    const count = Object.fromEntries(rows.map((a) => [a.name, deps.db.select().from(animalPhotos).where(eq(animalPhotos.animalId, a.id)).all().length]));
    expect(count).toEqual({ Baxter: 2, Frida: 1, Nala: 1, Juno: 1, Pelle: 3, Mika: 3 });
    const assetIds = deps.db.select().from(animalPhotos).all().map((p) => p.assetId);
    expect(new Set(assetIds).size).toBe(assetIds.length);
    const nala = rows.find((a) => a.name === 'Nala')!;
    const story = deps.db.select().from(animalStories).where(eq(animalStories.animalId, nala.id)).get()!;
    expect(story.beforeAssetId).not.toBeNull();
    expect(story.afterAssetId).not.toBeNull();
    expect(story.beforeAssetId).not.toBe(story.afterAssetId);
  });

  it('seeds proposals of every kind from an invented source, open and decided, idempotent', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const rows = deps.db.select().from(animalProposals).all();
    expect(new Set(rows.filter((r) => r.state === 'open').map((r) => r.kind))).toEqual(new Set(['create', 'update', 'notice', 'sameAs']));
    expect(rows.some((r) => r.state === 'accepted' || r.state === 'acceptedWithChanges')).toBe(true);
    expect(rows.some((r) => r.state === 'rejected')).toBe(true);
    expect(rows.some((r) => r.state === 'withdrawn')).toBe(true);
    expect(rows.some((r) => r.noticeKind === 'delisted')).toBe(true);
    expect(readSetting(deps, PROPOSALS_ENABLED_KEY)).toBe(true);
    const list = unwrap(await listProposals(deps, ctxWith(['animals.manage'])));
    expect(list.open.withConflict).toBeGreaterThanOrEqual(1);
    expect(list.proposals.some((p) => p.kind === 'create' && p.missing.length > 0)).toBe(true);
    expect(list.proposals.some((p) => p.hintCount > 0)).toBe(true);
    // Für den Stapel (Plan B): eine Änderung und ein neuer Hund, die rechts mit einem Wisch durchgehen.
    expect(list.proposals.some((p) => p.kind === 'update' && p.conflictCount === 0 && p.hintCount === 0)).toBe(true);
    expect(list.proposals.some((p) => p.kind === 'create' && p.missing.length === 0 && p.hintCount === 0)).toBe(true);
    await seedDevelopment(deps);
    expect(deps.db.select().from(animalProposals).all()).toHaveLength(rows.length);
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
