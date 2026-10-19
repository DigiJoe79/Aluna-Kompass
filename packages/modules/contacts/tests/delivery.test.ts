import { coreModule, unwrap, writeSettingInternal } from '@kompass/core';
import { auditEntry, createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { deliveryForContactInternal } from '../src/delivery';
import { contactsModule } from '../src/manifest';
import { createContact, getContact, listContacts, setContactChannels, setContactStatus, updateContact } from '../src/service';

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule] });
  const userId = insertUser(deps, {});
  const ctx = ctxWith(['contacts.view', 'contacts.manage', 'settings.manage'], userId);
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctx, 'modules.enabled', ['contacts']);
  });
  return { deps, ctx };
}

const person = { kind: 'person' as const, firstName: 'Lena', lastName: 'Sommer' };

describe('delivery preference of a contact', () => {
  it('defaults to auto', async () => {
    const { deps, ctx } = setup();
    const created = unwrap(await createContact(deps, ctx, person));
    expect(created.deliveryPreference).toBe('auto');
  });

  it('uses the primary e-mail address', async () => {
    const { deps, ctx } = setup();
    const created = unwrap(await createContact(deps, ctx, person));
    unwrap(
      await setContactChannels(deps, ctx, {
        id: created.id,
        channels: [
          { kind: 'phone', value: '0123 4567', isPrimary: false },
          { kind: 'email', value: 'privat@example.org', isPrimary: false },
          { kind: 'email', value: 'lena@example.org', isPrimary: true },
        ],
      }),
    );
    expect(deliveryForContactInternal(deps.db, created.id)).toEqual({ channel: 'email', address: 'lena@example.org', via: 'self' });
  });

  it('takes the first e-mail address when none is primary', async () => {
    const { deps, ctx } = setup();
    const created = unwrap(await createContact(deps, ctx, person));
    unwrap(
      await setContactChannels(deps, ctx, {
        id: created.id,
        channels: [
          { kind: 'phone', value: '0123 4567', isPrimary: true },
          { kind: 'email', value: 'erste@example.org' },
          { kind: 'email', value: 'zweite@example.org' },
        ],
      }),
    );
    expect(deliveryForContactInternal(deps.db, created.id)).toEqual({ channel: 'email', address: 'erste@example.org', via: 'self' });
  });

  it('falls back to post without an e-mail address', async () => {
    const { deps, ctx } = setup();
    const created = unwrap(await createContact(deps, ctx, person));
    unwrap(await setContactChannels(deps, ctx, { id: created.id, channels: [{ kind: 'phone', value: '0123 4567' }] }));
    expect(deliveryForContactInternal(deps.db, created.id)).toEqual({ channel: 'post', reason: 'noEmail' });
  });

  it('honours post as preference despite an address, and audits the change', async () => {
    const { deps, ctx } = setup();
    const created = unwrap(await createContact(deps, ctx, { ...person, deliveryPreference: 'auto' }));
    unwrap(await setContactChannels(deps, ctx, { id: created.id, channels: [{ kind: 'email', value: 'lena@example.org', isPrimary: true }] }));
    const updated = unwrap(await updateContact(deps, ctx, { id: created.id, deliveryPreference: 'post' }));
    expect(updated.deliveryPreference).toBe('post');
    expect(deliveryForContactInternal(deps.db, created.id)).toEqual({ channel: 'post', reason: 'preference' });

    const audit = auditEntry(deps, 'contacts.update');
    expect(JSON.parse(audit.after!)).toEqual({ changedFields: ['deliveryPreference'] });
    expect(JSON.parse(audit.params!)).toEqual({ scope: 'delivery' });
    expect(JSON.stringify(audit)).not.toContain('lena@example.org');
  });

  it('refuses an unknown preference', async () => {
    const { deps, ctx } = setup();
    const created = unwrap(await createContact(deps, ctx, person));
    const result = await updateContact(deps, ctx, { id: created.id, deliveryPreference: 'fax' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('validation');
  });
});

describe('delivery for a person at an organization (Spec PDF per E-Mail § 4.1)', () => {
  async function atOrganization(orgChannels: { kind: 'email' | 'phone'; value: string; isPrimary?: boolean }[]) {
    const { deps, ctx } = setup();
    const org = unwrap(await createContact(deps, ctx, { kind: 'organization', name: 'Beispiel GmbH' }));
    unwrap(await setContactChannels(deps, ctx, { id: org.id, channels: orgChannels }));
    const created = unwrap(await createContact(deps, ctx, { ...person, belongsToId: org.id }));
    return { deps, ctx, created };
  }

  it('uses the own address first', async () => {
    const { deps, ctx, created } = await atOrganization([{ kind: 'email', value: 'info@beispiel.example', isPrimary: true }]);
    unwrap(await setContactChannels(deps, ctx, { id: created.id, channels: [{ kind: 'email', value: 'lena@example.org' }] }));
    expect(deliveryForContactInternal(deps.db, created.id)).toEqual({ channel: 'email', address: 'lena@example.org', via: 'self' });
  });

  it('without an own address takes the organization’s, primary first', async () => {
    const { deps, created } = await atOrganization([
      { kind: 'email', value: 'zentrale@beispiel.example' },
      { kind: 'email', value: 'info@beispiel.example', isPrimary: true },
    ]);
    expect(deliveryForContactInternal(deps.db, created.id)).toEqual({ channel: 'email', address: 'info@beispiel.example', via: 'organization' });
  });

  it('the person’s “always by post” comes first', async () => {
    const { deps, ctx, created } = await atOrganization([{ kind: 'email', value: 'info@beispiel.example', isPrimary: true }]);
    unwrap(await updateContact(deps, ctx, { id: created.id, deliveryPreference: 'post' }));
    expect(deliveryForContactInternal(deps.db, created.id)).toEqual({ channel: 'post', reason: 'preference' });
  });

  it('an organization without address means post', async () => {
    const { deps, created } = await atOrganization([{ kind: 'phone', value: '0123 4567' }]);
    expect(deliveryForContactInternal(deps.db, created.id)).toEqual({ channel: 'post', reason: 'noEmail' });
  });
});


describe('getContact: delivery, organization and people (Handoff 2b E1, Nachtrag Ansprechpersonen)', () => {
  it('reports the automatic way even when the contact wants post', async () => {
    const { deps, ctx } = setup();
    const created = unwrap(await createContact(deps, ctx, { ...person, deliveryPreference: 'post' }));
    unwrap(await setContactChannels(deps, ctx, { id: created.id, channels: [{ kind: 'email', value: 'lena@example.org', isPrimary: true }] }));
    const read = unwrap(await getContact(deps, ctx, created.id));
    expect(read.delivery).toEqual({ current: { channel: 'post', reason: 'preference' }, automatic: { channel: 'email', address: 'lena@example.org', via: 'self' } });
  });

  it('lists the people of an organization by last name with their main channel', async () => {
    const { deps, ctx } = setup();
    const org = unwrap(await createContact(deps, ctx, { kind: 'organization', name: 'Beispiel GmbH' }));
    const zora = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Zora', lastName: 'Arndt', belongsToId: org.id }));
    unwrap(await setContactChannels(deps, ctx, { id: zora.id, channels: [{ kind: 'phone', value: '0123 1' }, { kind: 'email', value: 'zora@example.org', isPrimary: true }] }));
    const bert = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Bert', lastName: 'Zander', belongsToId: org.id }));
    unwrap(await setContactChannels(deps, ctx, { id: bert.id, channels: [{ kind: 'phone', value: '0123 2' }] }));
    const gone = unwrap(await createContact(deps, ctx, { kind: 'person', lastName: 'Archiv', belongsToId: org.id }));
    unwrap(await setContactStatus(deps, ctx, { id: gone.id, status: 'archived' }));
    unwrap(await createContact(deps, ctx, { kind: 'person', lastName: 'Fremd' }));

    const read = unwrap(await getContact(deps, ctx, org.id));
    expect(read.people).toEqual([
      { id: zora.id, name: 'Zora Arndt', channel: { kind: 'email', value: 'zora@example.org' } },
      { id: bert.id, name: 'Bert Zander', channel: { kind: 'phone', value: '0123 2' } },
    ]);
    expect(unwrap(await getContact(deps, ctx, bert.id)).people).toEqual([]);
  });

  it('finds a person by the name of the organization', async () => {
    const { deps, ctx } = setup();
    const org = unwrap(await createContact(deps, ctx, { kind: 'organization', name: 'Finanzamt Beispielstadt' }));
    const klein = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Sabine', lastName: 'Klein', belongsToId: org.id }));
    unwrap(await createContact(deps, ctx, { kind: 'person', lastName: 'Fremd' }));
    const found = unwrap(await listContacts(deps, ctx, { text: 'finanzamt', kind: 'person' }));
    expect(found.contacts.map((c) => c.id)).toEqual([klein.id]);
  });
});
