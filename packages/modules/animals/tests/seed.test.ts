import { coreModule, seedDevelopment } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule } from '../src/manifest';
import { eq } from 'drizzle-orm';
import { animalPhotos, animalStories, animals } from '../src/schema';

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
    const bySlug = Object.fromEntries(rows.map((a) => [a.slug, a.place]));
    expect(bySlug.baxter).toBe('Rumänien, Ploiești');
    expect(bySlug.frida).toBe('Nordrhein-Westfalen');
    expect(bySlug.nala).toBe('Rumänien, Cluj-Napoca');
    expect(bySlug.juno).toBe('Baden-Württemberg');
    expect(bySlug.pelle).toBe('Rumänien, Brașov');
    expect(bySlug.mika).toBe('Niedersachsen');
  });

  it('leaves one animal untranslated so translations_list_gaps has something to show', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const rows = deps.db.select().from(animals).all();
    // `noUncheckedIndexedAccess` macht Record-Zugriffe optional — Helfer statt Cast-Wiederholung.
    const locale = (summary: unknown, code: string): string => (summary as Record<string, string | undefined>)[code] ?? '';
    const gap = rows.filter((a) => locale(a.summary, 'de').length > 0 && locale(a.summary, 'en').length === 0);
    expect(gap.map((a) => a.slug)).toEqual(['frida']);
    expect(rows.filter((a) => locale(a.summary, 'en').length > 0).length).toBeGreaterThanOrEqual(2);
  });

  it('seeds two animals waiting for review: one new and unpublished, one published and changed, both with photos', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const pending = deps.db.select().from(animals).all().filter((a) => a.reviewRequestedAt !== null);
    expect(pending.map((a) => [a.slug, a.isPublished, a.reviewNote]).sort()).toEqual([['mika', true, 'Text und Fotos geändert'], ['pelle', false, 'neu']]);
    for (const a of pending) expect(deps.db.select().from(animalPhotos).where(eq(animalPhotos.animalId, a.id)).all().length).toBeGreaterThanOrEqual(2);
  });

  it('gives the two waiting animals different review times, so the queue order does not depend on the name', async () => {
    // Die Testuhr steht still: Ohne eigenen Abstand bekämen beide denselben Zeitpunkt.
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const at = Object.fromEntries(deps.db.select().from(animals).all().map((a) => [a.slug, a.reviewRequestedAt]));
    expect(at.pelle! < at.mika!).toBe(true);
  });
});
