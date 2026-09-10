import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { contactChannels, contactRoles, contacts } from '../src/schema';

describe('contacts schema', () => {
  it('stores a person, a channel and a role and reads them back', () => {
    const deps = createTestDeps();
    deps.db.insert(contacts).values({
      id: 'C1', kind: 'person', salutation: 'Frau', firstName: 'Anna', lastName: 'Berger',
      street: 'Musterweg 1', postalCode: '12345', city: 'Musterstadt', country: 'DE',
      status: 'active', createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:00:00.000Z',
    }).run();
    deps.db.insert(contactChannels).values({ id: 'CH1', contactId: 'C1', kind: 'email', value: 'anna@example.org', isPrimary: true }).run();
    deps.db.insert(contactRoles).values({ id: 'R1', contactId: 'C1', role: 'interested', since: '2026-01-01' }).run();

    const row = deps.db.select().from(contacts).all()[0]!;
    expect([row.kind, row.lastName, row.status]).toEqual(['person', 'Berger', 'active']);
    expect(deps.db.select().from(contactChannels).all()[0]!.isPrimary).toBe(true);
    expect(deps.db.select().from(contactRoles).all()[0]!.until).toBeNull();
  });

  it('links a person to an organisation through belongsToId', () => {
    const deps = createTestDeps();
    const base = { status: 'active' as const, createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:00:00.000Z' };
    deps.db.insert(contacts).values({ id: 'ORG', kind: 'organization', name: 'Sparkasse Musterstadt', legalForm: 'Anstalt des öffentlichen Rechts', ...base }).run();
    deps.db.insert(contacts).values({ id: 'P', kind: 'person', firstName: 'Bea', lastName: 'Klein', belongsToId: 'ORG', ...base }).run();

    const person = deps.db.select().from(contacts).all().find((c) => c.id === 'P')!;
    expect(person.belongsToId).toBe('ORG');
  });

  it('rejects a belongsToId that points at no existing contact', () => {
    const deps = createTestDeps();
    const base = { status: 'active' as const, createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:00:00.000Z' };
    expect(() =>
      deps.db.insert(contacts).values({ id: 'P', kind: 'person', firstName: 'Bea', lastName: 'Klein', belongsToId: 'GHOST', ...base }).run(),
    ).toThrow(/FOREIGN KEY/i);
  });
});
