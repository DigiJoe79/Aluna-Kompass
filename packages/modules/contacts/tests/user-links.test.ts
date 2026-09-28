import { coreModule, holdsFor, schema, unwrap, writeSettingInternal, type CallContext, type Deps } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { contacts, contactUserLinks } from '../src/schema';
import { addContactRole, createContact, deleteContact, endContactRole } from '../src/service';
import { contactIdForUserInternal, getUserLink, hasLinkHistoryInternal, linkUserToContact, listUserLinkChanges, unlinkUser, userIdForContactInternal, userLinkChangesInternal } from '../src/user-links';

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

const code = (r: { ok: boolean; error?: { type: string; code?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

async function world() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule] });
  // Das Modul muss eingeschaltet sein: Halter und Rollen kennt der Kern nur von eingeschalteten Modulen.
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['contacts'], 'test.enable'));
  const adminId = insertUser(deps, { name: 'Admin', email: 'admin@kompass.local' });
  const helperId = insertUser(deps, { name: 'Helferin', email: 'helferin@kompass.local' });
  const admin = ctxWith(['users.manage', 'contacts.view', 'contacts.manage'], adminId);
  const mk = async (lastName: string) => unwrap(await createContact(deps, admin, { kind: 'person', firstName: 'Erika', lastName })).id;
  return { deps, admin, adminId, helperId, c1: await mk('Eins'), c2: await mk('Zwei') };
}

describe('linking a user account to a contact', () => {
  it('needs users.manage, an existing account and an existing contact', async () => {
    const { deps, admin, helperId, c1 } = await world();
    expect(code(await linkUserToContact(deps, ctxWith(['contacts.manage']), { userId: helperId, contactId: c1 }))).toBe('forbidden');
    expect(code(await linkUserToContact(deps, admin, { userId: 'nobody', contactId: c1 }))).toBe('notFound');
    expect(code(await linkUserToContact(deps, admin, { userId: helperId, contactId: 'nothing' }))).toBe('notFound');
  });

  it('links, reads back, refuses a second open link on either side, and logs without names', async () => {
    const { deps, admin, adminId, helperId, c1, c2 } = await world();
    const link = unwrap(await linkUserToContact(deps, admin, { userId: helperId, contactId: c1 }));
    expect(link).toMatchObject({ userId: helperId, contactId: c1, linkedByUserId: adminId, unlinkedAt: null });
    expect(unwrap(await getUserLink(deps, admin, { userId: helperId }))).toMatchObject({ link: { id: link.id }, contactName: 'Erika Eins' });
    expect(code(await linkUserToContact(deps, admin, { userId: helperId, contactId: c2 }))).toBe('userAlreadyLinked');
    expect(code(await linkUserToContact(deps, admin, { userId: adminId, contactId: c1 }))).toBe('contactAlreadyLinked');
    const entry = deps.db.select().from(schema.auditLog).all().at(-1)!;
    expect(entry.action).toBe('contacts.userLink.create');
    expect(`${entry.summary}${entry.after}`).not.toMatch(/Erika|Eins|Helferin/);
  });

  it('unlinking ends the row and keeps it; the account can be linked again', async () => {
    const { deps, admin, adminId, helperId, c1, c2 } = await world();
    unwrap(await linkUserToContact(deps, admin, { userId: helperId, contactId: c1 }));
    const ended = unwrap(await unlinkUser(deps, admin, { userId: helperId }));
    expect(ended).toMatchObject({ unlinkedByUserId: adminId });
    expect(ended.unlinkedAt).not.toBeNull();
    expect(code(await unlinkUser(deps, admin, { userId: helperId }))).toBe('userNotLinked');
    unwrap(await linkUserToContact(deps, admin, { userId: helperId, contactId: c2 }));
    expect(unwrap(await listUserLinkChanges(deps, admin, { from: '2026-01-01', to: '2026-12-31' }))).toHaveLength(2);
  });

  it('one may set one’s own link once — never change or remove it', async () => {
    const { deps, admin, adminId, c1, c2 } = await world();
    const own = unwrap(await linkUserToContact(deps, admin, { userId: adminId, contactId: c1 }));
    expect(own.linkedByUserId).toBe(adminId);
    expect(unwrap(await listUserLinkChanges(deps, admin, { from: '2026-01-01', to: '2026-12-31' }))[0]!.selfLinked).toBe(true);
    expect(code(await unlinkUser(deps, admin, { userId: adminId }))).toBe('ownLinkNeedsSecondPerson');
    // Eine zweite Person löst — danach darf man sich trotzdem nicht selbst neu verknüpfen.
    const secondId = insertUser(deps, { name: 'Zweite', email: 'zweite@kompass.local' });
    unwrap(await unlinkUser(deps, ctxWith(['users.manage'], secondId), { userId: adminId }));
    expect(code(await linkUserToContact(deps, admin, { userId: adminId, contactId: c2 }))).toBe('ownLinkNeedsSecondPerson');
  });
});

/** Den Kontakt fällig machen: eine längst beendete Rolle mit Frist, Anlage im Jahr 2000. */
async function makeDue(deps: Deps, ctx: CallContext, contactId: string) {
  const added = unwrap(await addContactRole(deps, ctx, { id: contactId, role: 'interested', since: '2000-01-01' }));
  unwrap(await endContactRole(deps, ctx, { roleId: added.roles[0]!.id, until: '2001-01-01' }));
  deps.db.update(contacts).set({ createdAt: '2000-01-01T00:00:00.000Z' }).where(eq(contacts.id, contactId)).run();
}

describe('a linked contact', () => {
  it('is held permanently while the link is open, and released when it ends', async () => {
    const { deps, admin, helperId, c1 } = await world();
    unwrap(await linkUserToContact(deps, admin, { userId: helperId, contactId: c1 }));
    expect(holdsFor(deps, 'contact', c1)).toContainEqual(expect.objectContaining({ entity: 'contactUserLink', until: null }));
    expect(code(await deleteContact(deps, admin, { id: c1 }))).toBe('retentionHoldActive');
    unwrap(await unlinkUser(deps, admin, { userId: helperId }));
    expect(holdsFor(deps, 'contact', c1).filter((h) => h.entity === 'contactUserLink')).toEqual([]);
  });

  it('a contact with only ended links can be deleted; the history stays', async () => {
    const { deps, admin, helperId, c1 } = await world();
    unwrap(await linkUserToContact(deps, admin, { userId: helperId, contactId: c1 }));
    unwrap(await unlinkUser(deps, admin, { userId: helperId }));
    await makeDue(deps, admin, c1);
    expect((await deleteContact(deps, admin, { id: c1 })).ok).toBe(true);
    expect(userLinkChangesInternal(deps.db, { from: '2026-01-01', to: '2026-12-31' })).toHaveLength(1);
  });
});

describe('hasLinkHistoryInternal', () => {
  it('is true once an account has ever been linked — open or ended — and false before', async () => {
    const { deps, admin, helperId, c1 } = await world();
    expect(hasLinkHistoryInternal(deps.db, helperId)).toBe(false);
    unwrap(await linkUserToContact(deps, admin, { userId: helperId, contactId: c1 }));
    expect(hasLinkHistoryInternal(deps.db, helperId)).toBe(true);
    unwrap(await unlinkUser(deps, admin, { userId: helperId }));
    expect(hasLinkHistoryInternal(deps.db, helperId)).toBe(true);
  });
});
