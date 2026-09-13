import { coreModule, seedDevelopment } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule } from '../src/manifest';
import { animalStories, animals } from '../src/schema';

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
});
