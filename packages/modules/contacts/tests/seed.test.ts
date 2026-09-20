import { coreModule, seedDevelopment } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { contactRoles, contacts, contactUserLinks } from '../src/schema';
import { contactsRetentionDue } from '../src/retention';

describe('contacts seed', () => {
  it('seeds a few example contacts with roles', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule], env: 'development' });
    await seedDevelopment(deps);
    const rows = deps.db.select().from(contacts).all();
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.some((c) => c.kind === 'organization')).toBe(true);
    expect(deps.db.select().from(contactRoles).all().length).toBeGreaterThan(0);
  });

  it('is idempotent', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule], env: 'development' });
    await seedDevelopment(deps);
    const count1 = deps.db.select().from(contacts).all().length;
    await seedDevelopment(deps);
    const count2 = deps.db.select().from(contacts).all().length;
    expect(count2).toBe(count1);
  });

  it('legt einen Kontakt an, dessen Frist abgelaufen ist — damit der Fristenbildschirm etwas zeigt', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule], env: 'development', now: '2026-09-17T08:00:00.000Z' });
    await seedDevelopment(deps);
    expect(contactsRetentionDue(deps).map((d) => d.label)).toEqual(['Lena Vogt']);
  });

  it('links one seeded user account to a seeded contact, once', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule], env: 'development' });
    await seedDevelopment(deps);
    await seedDevelopment(deps);
    const open = deps.db.select().from(contactUserLinks).all().filter((l) => l.unlinkedAt === null);
    expect(open).toHaveLength(1);
    expect(open[0]!.linkedByUserId).not.toBe(open[0]!.userId); // nicht selbst gesetzt
  });
});
