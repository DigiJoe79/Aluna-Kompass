import { coreModule, schema, seedDevelopment } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { contactChannels, contactRoles, contacts, contactUserLinks } from '../src/schema';
import { contactsRetentionDue } from '../src/retention';
import { deliveryForContactInternal } from '../src/delivery';

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
    const log = JSON.stringify(entries.map((e) => [e.before, e.after, e.params]));
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

  it('seeds a person at an organization and one who wants post (Nachtrag Ansprechpersonen, Handoff 2b E1)', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule], env: 'development' });
    await seedDevelopment(deps);
    const rows = deps.db.select().from(contacts).all();
    const organizations = new Set(rows.filter((c) => c.kind === 'organization').map((c) => c.id));
    const atOrganization = rows.filter((c) => c.kind === 'person' && c.belongsToId !== null && organizations.has(c.belongsToId));
    expect(atOrganization.some((c) => (deliveryForContactInternal(deps.db, c.id) as { via?: string }).via === 'organization')).toBe(true);
    expect(rows.some((c) => JSON.stringify(deliveryForContactInternal(deps.db, c.id)) === JSON.stringify({ channel: 'post', reason: 'preference' }))).toBe(true);
  });

  it('legt einen Kontakt an, dessen Frist abgelaufen ist — damit der Fristenbildschirm etwas zeigt', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule], env: 'development', now: '2026-09-17T08:00:00.000Z' });
    await seedDevelopment(deps);
    expect(contactsRetentionDue(deps).length).toBeGreaterThanOrEqual(1);
  });

  it('hängt jede Rolle am Stichjahr, keine an einer festen Jahreszahl (Befund 0.2.8/20)', async () => {
    // 2031 ist das Stichjahr; die älteste Rolle liegt drei Jahre davor.
    const deps = createTestDeps({ manifests: [coreModule, contactsModule], env: 'development', now: '2031-10-01T08:00:00.000Z' });
    await seedDevelopment(deps);
    expect(deps.db.select().from(contactRoles).all().every((r) => r.since >= '2028-01-01')).toBe(true);
    expect(contactsRetentionDue(deps).length).toBeGreaterThanOrEqual(1);
  });

  it('links one seeded user account to a seeded contact, once', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule], env: 'development' });
    await seedDevelopment(deps);
    await seedDevelopment(deps);
    const open = deps.db.select().from(contactUserLinks).all().filter((l) => l.unlinkedAt === null);
    expect(open).toHaveLength(1);
    expect(open[0]!.linkedByUserId).not.toBe(open[0]!.userId); // nicht selbst gesetzt
  });

  it('zeigt einen Verein nach einem Jahr: Behörden, Praxis, Verband, und eine Person, deren Rolle wechselt (Spec 2026-10-06 § 4)', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule], env: 'development' });
    await seedDevelopment(deps);
    const all = deps.db.select().from(contacts).all();
    expect(all.filter((c) => c.kind === 'organization').length).toBeGreaterThanOrEqual(3);
    // Jede Person mit Vor- und Nachnamen.
    for (const p of all.filter((c) => c.kind === 'person')) expect([p.firstName, p.lastName].every((v) => (v ?? '').trim().length > 0), `${p.firstName} ${p.lastName}`).toBe(true);
    // Eine Person, deren Rolle wechselt: eine beendete Rolle, danach eine offene.
    const changed = all.filter((c) => {
      const roles = deps.db.select().from(contactRoles).where(eq(contactRoles.contactId, c.id)).all();
      return roles.some((ended) => ended.until !== null && roles.some((open) => open.until === null && open.role !== ended.role && ended.until! < open.since));
    });
    expect(changed.length).toBeGreaterThanOrEqual(1);
    const today = deps.clock.now().toISOString().slice(0, 10);
    expect(deps.db.select().from(contactRoles).all().every((r) => r.since <= today && (r.until === null || r.until <= today))).toBe(true);
  });
});
