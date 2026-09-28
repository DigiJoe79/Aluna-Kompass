import { coreModule, schema, seedDevelopment } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { contactChannels, contactRoles, contacts, contactUserLinks } from '../src/schema';
import { contactsRetentionDue } from '../src/retention';

describe('contacts seed', () => {
  it('lässt keinen Namen, keine Anschrift, keine E-Mail und keine Notiz im Protokoll — es ist unlöschbar (Befund 48, W4)', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule], env: 'development' });
    await seedDevelopment(deps);
    const texts = new Set<string>();
    for (const row of deps.db.select().from(contacts).all()) {
      for (const value of [row.firstName, row.lastName, row.name, row.addressExtra, row.street, row.postalCode, row.city, row.notes]) if (value) texts.add(value);
    }
    for (const row of deps.db.select().from(contactChannels).all()) texts.add(row.value);
    expect(texts.size).toBeGreaterThan(10);
    const entries = deps.db.select().from(schema.auditLog).all().filter((e) => e.action.startsWith('contacts.'));
    expect(entries.length).toBeGreaterThan(5);
    const log = JSON.stringify(entries.map((e) => [e.before, e.after, e.summary]));
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const leaked = [...texts].filter((text) => new RegExp(`(?<![\\p{L}\\d])${escape(text)}(?![\\p{L}\\d])`, 'u').test(log));
    expect(leaked).toEqual([]);
  });

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
