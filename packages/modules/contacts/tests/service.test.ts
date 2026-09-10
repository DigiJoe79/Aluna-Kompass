import { coreModule, schema, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { createContact, getContact, listContacts, setContactStatus, updateContact } from '../src/service';

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule] });
  const userId = insertUser(deps, {});
  return { deps, ctx: ctxWith(['contacts.view', 'contacts.manage'], userId), userId };
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
