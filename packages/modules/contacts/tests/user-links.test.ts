import { coreModule } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { contactUserLinks } from '../src/schema';
import { contactIdForUserInternal, userIdForContactInternal, userLinkChangesInternal } from '../src/user-links';

const row = (over: Partial<typeof contactUserLinks.$inferInsert>) => ({ id: 'L1', userId: 'U1', contactId: 'C1', linkedAt: '2026-02-01T10:00:00.000Z', linkedByUserId: 'U9', unlinkedAt: null, unlinkedByUserId: null, ...over });

describe('contacts_user_links', () => {
  it('allows one open link per user and one per contact, and any number of ended ones', () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule] });
    deps.db.insert(contactUserLinks).values(row({ id: 'L0', unlinkedAt: '2026-01-15T00:00:00.000Z', unlinkedByUserId: 'U9', linkedAt: '2026-01-01T00:00:00.000Z' })).run();
    deps.db.insert(contactUserLinks).values(row({})).run();
    expect(() => deps.db.insert(contactUserLinks).values(row({ id: 'L2', contactId: 'C2' })).run()).toThrow(); // U1 ist schon offen verknüpft
    expect(() => deps.db.insert(contactUserLinks).values(row({ id: 'L3', userId: 'U2' })).run()).toThrow(); // C1 auch
  });

  it('looks up the open link in both directions and ignores ended ones', () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule] });
    deps.db.insert(contactUserLinks).values(row({ id: 'L0', contactId: 'C0', unlinkedAt: '2026-01-15T00:00:00.000Z', unlinkedByUserId: 'U9', linkedAt: '2026-01-01T00:00:00.000Z' })).run();
    deps.db.insert(contactUserLinks).values(row({})).run();
    expect(contactIdForUserInternal(deps.db, 'U1')).toBe('C1');
    expect(userIdForContactInternal(deps.db, 'C1')).toBe('U1');
    expect(userIdForContactInternal(deps.db, 'C0')).toBeNull();
    expect(contactIdForUserInternal(deps.db, 'U7')).toBeNull();
  });

  it('reports every change within a period, and whether someone linked themselves', () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule] });
    deps.db.insert(contactUserLinks).values(row({ id: 'OLD', userId: 'U3', contactId: 'C3', linkedAt: '2025-03-01T00:00:00.000Z', unlinkedAt: '2026-04-01T00:00:00.000Z', unlinkedByUserId: 'U9' })).run();
    deps.db.insert(contactUserLinks).values(row({ id: 'SELF', linkedByUserId: 'U1' })).run();
    deps.db.insert(contactUserLinks).values(row({ id: 'OUT', userId: 'U4', contactId: 'C4', linkedAt: '2024-01-01T00:00:00.000Z' })).run();
    const changes = userLinkChangesInternal(deps.db, { from: '2026-01-01', to: '2026-12-31' });
    expect(changes.map((c) => [c.id, c.selfLinked])).toEqual([['OLD', false], ['SELF', true]]);
  });
});
