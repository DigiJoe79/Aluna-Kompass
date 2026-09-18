import { coreModule, defineModule, schema, unwrap, writeSettingInternal, type ModuleManifest } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { contactRetention, createContact, deleteContact, listDueContacts, addContactRole, endContactRole } from '../src/service';
import { contactChannels, contactRoles, contacts } from '../src/schema';

/** Ein Fachmodul, das einen Kontakt über ein Dokument festhält. */
const holdingModule: ModuleManifest = defineModule({
  key: 'finance',
  version: '1',
  permissions: ['finance.view'],
  dependsOn: ['contacts'],
  contactRoles: [{ key: 'donor', retention: 'statutory10Y' }],
  retentionHolds: (_deps, entityType, id) =>
    entityType === 'contact' && id === 'HELD' ? [{ label: 'Zuwendungsbestätigung BST-2026-0042', until: '2036-12-31', entity: 'document', id: 'D1' }] : [],
});

function setup(manifests: ModuleManifest[] = [coreModule, contactsModule], enabled = ['contacts']) {
  const deps = createTestDeps({ manifests });
  const userId = insertUser(deps, {});
  const ctx = ctxWith(['contacts.view', 'contacts.manage', 'settings.manage'], userId);
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctx, 'modules.enabled', enabled, 'test.enable');
  });
  return { deps, ctx, userId };
}

const anna = { kind: 'person' as const, firstName: 'Anna', lastName: 'Berger' };

describe('contact retention and deletion', () => {
  it('reports a running role as a hold with its computed end date', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    unwrap(await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2026-03-15' }));

    const r = unwrap(await contactRetention(deps, ctx, c.id));
    // consent = 24 Monate, gerechnet ab Ablauf des Kalenderjahres 2026.
    expect(r.until).toBe('2028-12-31');
    expect(r.due).toBe(false);
    expect(r.holds[0]!.label).toContain('interested');
  });

  it('never becomes due while a permanent role runs', async () => {
    const { deps, ctx } = setup();
    const office = unwrap(await createContact(deps, ctx, { kind: 'organization', name: 'Finanzamt Musterstadt' }));
    unwrap(await addContactRole(deps, ctx, { id: office.id, role: 'authority', since: '2026-01-01' }));
    const r = unwrap(await contactRetention(deps, ctx, office.id));
    expect(r.until).toBeNull();
    expect(r.due).toBe(false);
  });

  it('takes the longest hold across modules', async () => {
    const { deps, ctx } = setup([coreModule, contactsModule, holdingModule], ['contacts', 'finance']);
    deps.db.insert(contacts).values({ id: 'HELD', kind: 'person', lastName: 'Spender', status: 'active', createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:00:00.000Z' }).run();
    deps.db.insert(contactRoles).values({ id: 'RR', contactId: 'HELD', role: 'interested', since: '2026-03-15' }).run();

    const r = unwrap(await contactRetention(deps, ctx, 'HELD'));
    expect(r.until).toBe('2036-12-31');
    expect(r.holds.map((h) => h.label).some((l) => l.includes('BST-2026-0042'))).toBe(true);
  });

  it('refuses to delete while a hold is running and names the holders', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    unwrap(await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2026-03-15' }));
    const res = await deleteContact(deps, ctx, { id: c.id });
    expect(res.ok === false && res.error.type === 'conflict' && res.error.code === 'retentionHoldActive').toBe(true);
    if (!res.ok && res.error.type === 'conflict') {
      expect(res.error.message).toContain('interested');
    }
  });

  it('deletes a contact with no running hold, removes its rows and audits it', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    const added = unwrap(await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2020-01-01' }));
    unwrap(await endContactRole(deps, ctx, { roleId: added.roles[0]!.id, until: '2021-01-01' }));
    // consent ab Ablauf 2021 = 31.12.2023, die Testuhr steht 2026 → fällig.

    expect(unwrap(await deleteContact(deps, ctx, { id: c.id })).id).toBe(c.id);
    expect(deps.db.select().from(contacts).all()).toHaveLength(0);
    expect(deps.db.select().from(contactRoles).all()).toHaveLength(0);
    expect(deps.db.select().from(contactChannels).all()).toHaveLength(0);
    const entry = deps.db.select().from(schema.auditLog).all().find((e) => e.action === 'contacts.delete');
    expect(entry?.summary).toContain('Anna Berger');
  });

  it('refuses to delete a contact that nothing holds at all, because nothing proves it may go', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    const res = await deleteContact(deps, ctx, { id: c.id });
    expect(res.ok === false && res.error.type === 'conflict' && res.error.code === 'retentionUnknown').toBe(true);
  });

  it('lists the due contacts and refuses the list without contacts.manage', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    const added = unwrap(await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2020-01-01' }));
    unwrap(await endContactRole(deps, ctx, { roleId: added.roles[0]!.id, until: '2021-01-01' }));

    const due = unwrap(await listDueContacts(deps, ctx));
    expect(due.map((d) => d.id)).toEqual([c.id]);
    expect(due[0]!.dueSince).toBe('2023-12-31');
    expect((await listDueContacts(deps, ctxWith(['contacts.view']))).ok).toBe(false);
  });
});
