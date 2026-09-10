import { coreModule, schema, unwrap, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { createContact, getContact, listContacts, setContactStatus, updateContact } from '../src/service';

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule] });
  const userId = insertUser(deps, {});
  const ctx = ctxWith(['contacts.view', 'contacts.manage', 'settings.manage'], userId);
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctx, 'modules.enabled', ['contacts'], 'test.enable');
  });
  return { deps, ctx, userId };
}

const anna = { kind: 'person' as const, salutation: 'Frau', firstName: 'Anna', lastName: 'Berger', street: 'Musterweg 1', postalCode: '12345', city: 'Musterstadt' };

describe('contacts service', () => {
  it('creates a person, reads it back with an empty role and channel list, and audits it', async () => {
    const { deps, ctx } = setup();
    const created = unwrap(await createContact(deps, ctx, anna));
    expect(created).toMatchObject({ kind: 'person', lastName: 'Berger', status: 'active' });
    expect(created.roles).toEqual([]);
    expect(created.channels).toEqual([]);
    expect(created.belongsTo).toBeNull();

    const audit = deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'contacts.create');
    expect(audit).toHaveLength(1);
    expect(audit[0]!.summary).toContain('Anna Berger');
  });

  it('requires a last name for a person and a name for an organisation', async () => {
    const { deps, ctx } = setup();
    const noLastName = await createContact(deps, ctx, { kind: 'person', firstName: 'Anna' });
    expect(noLastName.ok === false && noLastName.error.type === 'validation').toBe(true);
    const noName = await createContact(deps, ctx, { kind: 'organization' });
    expect(noName.ok === false && noName.error.type === 'validation').toBe(true);
    expect((await createContact(deps, ctx, { kind: 'organization', name: 'Sparkasse Musterstadt' })).ok).toBe(true);
  });

  it('refuses without contacts.manage', async () => {
    const { deps } = setup();
    const denied = await createContact(deps, ctxWith(['contacts.view']), anna);
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });

  it('updates a contact and records what changed', async () => {
    const { deps, ctx } = setup();
    const created = unwrap(await createContact(deps, ctx, anna));
    const updated = unwrap(await updateContact(deps, ctx, { id: created.id, city: 'Neustadt' }));
    expect(updated.city).toBe('Neustadt');
    expect(deps.db.select().from(schema.auditLog).all().some((e) => e.action === 'contacts.update')).toBe(true);
    const missing = await updateContact(deps, ctx, { id: 'GIBTSNICHT', city: 'x' });
    expect(missing.ok === false && missing.error.type === 'notFound').toBe(true);
  });

  it('resolves belongsTo when a person sits at an organisation', async () => {
    const { deps, ctx } = setup();
    const org = unwrap(await createContact(deps, ctx, { kind: 'organization', name: 'Sparkasse Musterstadt', street: 'Bankplatz 2', postalCode: '12345', city: 'Musterstadt' }));
    const person = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Bea', lastName: 'Klein', belongsToId: org.id }));
    expect(unwrap(await getContact(deps, ctx, person.id)).belongsTo?.name).toBe('Sparkasse Musterstadt');
  });

  it('refuses a belongsTo that points at a person or at itself', async () => {
    const { deps, ctx } = setup();
    const a = unwrap(await createContact(deps, ctx, anna));
    const atPerson = await createContact(deps, ctx, { kind: 'person', lastName: 'Klein', belongsToId: a.id });
    expect(atPerson.ok === false && atPerson.error.type === 'conflict' && atPerson.error.code === 'belongsToNotAnOrganization').toBe(true);
    const atSelf = await updateContact(deps, ctx, { id: a.id, belongsToId: a.id });
    expect(atSelf.ok === false && atSelf.error.type === 'conflict' && atSelf.error.code === 'belongsToNotAnOrganization').toBe(true);
  });

  it('lists actives newest first, filters by kind and finds by text', async () => {
    const { deps, ctx } = setup();
    unwrap(await createContact(deps, ctx, anna));
    deps.clock.advance(1000);
    const org = unwrap(await createContact(deps, ctx, { kind: 'organization', name: 'Sparkasse Musterstadt', city: 'Musterstadt' }));
    deps.clock.advance(1000);
    const archived = unwrap(await createContact(deps, ctx, { kind: 'person', lastName: 'Alt' }));
    unwrap(await setContactStatus(deps, ctx, { id: archived.id, status: 'archived' }));

    const active = unwrap(await listContacts(deps, ctx, {}));
    expect(active.total).toBe(2);
    expect(active.contacts[0]!.id).toBe(org.id);
    expect(unwrap(await listContacts(deps, ctx, { kind: 'organization' })).total).toBe(1);
    expect(unwrap(await listContacts(deps, ctx, { text: 'berger' })).total).toBe(1);
    expect(unwrap(await listContacts(deps, ctx, { text: 'musterstadt' })).total).toBe(2);
    expect(unwrap(await listContacts(deps, ctx, { includeArchived: true })).total).toBe(3);
    expect((await listContacts(deps, ctxWith([]), {})).ok).toBe(false);
  });
});

import { addContactRole, endContactRole, setContactChannels } from '../src/service';

describe('contact channels and roles', () => {
  it('replaces the whole channel set and keeps exactly one primary', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    const withTwo = unwrap(await setContactChannels(deps, ctx, {
      id: c.id,
      channels: [
        { kind: 'email', value: 'anna@example.org', isPrimary: true },
        { kind: 'mobile', value: '0157 000', label: 'privat' },
      ],
    }));
    expect(withTwo.channels).toHaveLength(2);
    expect(withTwo.channels.filter((ch) => ch.isPrimary)).toHaveLength(1);

    const replaced = unwrap(await setContactChannels(deps, ctx, { id: c.id, channels: [{ kind: 'phone', value: '030 000' }] }));
    expect(replaced.channels.map((ch) => ch.kind)).toEqual(['phone']);
    // Ohne ausdrückliche Angabe wird der erste Weg der primäre.
    expect(replaced.channels[0]!.isPrimary).toBe(true);
    expect(deps.db.select().from(schema.auditLog).all().some((e) => e.action === 'contacts.setChannels')).toBe(true);
  });

  it('refuses more than one primary channel', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    const bad = await setContactChannels(deps, ctx, { id: c.id, channels: [{ kind: 'email', value: 'a@example.org', isPrimary: true }, { kind: 'phone', value: '1', isPrimary: true }] });
    expect(bad.ok === false && bad.error.type === 'conflict' && bad.error.code === 'multiplePrimaryChannels').toBe(true);
  });

  it('adds a known role and refuses an unknown one', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    const withRole = unwrap(await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2026-01-01' }));
    expect(withRole.roles.map((r) => [r.role, r.since, r.until])).toEqual([['interested', '2026-01-01', null]]);

    const unknown = await addContactRole(deps, ctx, { id: c.id, role: 'erfunden', since: '2026-01-01' });
    expect(unknown.ok === false && unknown.error.type === 'validation' && unknown.error.issues[0]?.path === 'role').toBe(true);
  });

  it('refuses the same role twice while it is still running', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    unwrap(await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2026-01-01' }));
    const again = await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2026-02-01' });
    expect(again.ok === false && again.error.type === 'conflict' && again.error.code === 'roleAlreadyRunning').toBe(true);
  });

  it('ends a role by setting until, without deleting the row', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    const added = unwrap(await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2026-01-01' }));
    const ended = unwrap(await endContactRole(deps, ctx, { roleId: added.roles[0]!.id, until: '2026-06-30' }));
    expect(ended.roles).toHaveLength(1);
    expect(ended.roles[0]!.until).toBe('2026-06-30');
    expect(deps.db.select().from(schema.auditLog).all().some((e) => e.action === 'contacts.endRole')).toBe(true);

    // Danach darf dieselbe Rolle wieder beginnen.
    expect((await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2026-07-01' })).ok).toBe(true);
  });

  it('refuses both without contacts.manage', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    expect((await setContactChannels(deps, ctxWith(['contacts.view']), { id: c.id, channels: [] })).ok).toBe(false);
    expect((await addContactRole(deps, ctxWith(['contacts.view']), { id: c.id, role: 'interested', since: '2026-01-01' })).ok).toBe(false);
  });

  it('finds a contact by a communication channel value, not only by name and city', async () => {
    const { deps, ctx } = setup();
    const berger = unwrap(await createContact(deps, ctx, { kind: 'person', lastName: 'Berger' }));
    unwrap(await createContact(deps, ctx, { kind: 'person', lastName: 'Klein' }));
    // Der gesuchte Weg ist bewusst nicht der primäre.
    unwrap(await setContactChannels(deps, ctx, {
      id: berger.id,
      channels: [
        { kind: 'email', value: 'berger@example.org', isPrimary: true },
        { kind: 'mobile', value: '+49 157 1234567' },
      ],
    }));

    const byNumber = unwrap(await listContacts(deps, ctx, { text: '157 1234567' }));
    expect(byNumber.contacts.map((c) => c.lastName)).toEqual(['Berger']);
    expect(byNumber.total).toBe(1);
  });

  it('filters by role and keeps only contacts whose role still runs', async () => {
    const { deps, ctx } = setup();
    const current = unwrap(await createContact(deps, ctx, { kind: 'person', lastName: 'Laufend' }));
    const past = unwrap(await createContact(deps, ctx, { kind: 'person', lastName: 'Beendet' }));
    unwrap(await addContactRole(deps, ctx, { id: current.id, role: 'partner', since: '2026-01-01' }));
    const endedRole = unwrap(await addContactRole(deps, ctx, { id: past.id, role: 'partner', since: '2026-01-01' }));
    unwrap(await endContactRole(deps, ctx, { roleId: endedRole.roles[0]!.id, until: '2026-02-01' }));

    const partners = unwrap(await listContacts(deps, ctx, { role: 'partner' }));
    expect(partners.contacts.map((c) => c.lastName)).toEqual(['Laufend']);
    expect(partners.total).toBe(1);
  });
});
