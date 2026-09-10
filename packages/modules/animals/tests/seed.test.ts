import { coreModule, seedDevelopment } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule } from '../src/manifest';
import { animals } from '../src/schema';

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
});
