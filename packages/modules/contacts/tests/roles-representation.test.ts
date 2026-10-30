import { coreModule, defineModule, schema, unwrap, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { addContactRole, createContact, updateContactRole } from '../src/service';

/**
 * „vertritt nach § 26 BGB“ (Ve-L-5): nur bei Rollen, deren Definition `representation` trägt. Ein Testmodul bringt eine
 * solche Rolle (`board-member`), eine ohne (`donor`) und eine geführte (`member`).
 */
const boardLike = defineModule({
  key: 'boardlike',
  version: '1',
  permissions: ['boardlike.read'],
  dependsOn: ['contacts'],
  contactRoles: [
    { key: 'board-member', retention: 'none', representation: true },
    { key: 'donor', retention: 'none' },
    { key: 'member', retention: 'none', managedBy: 'boardlike' },
  ],
});

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, boardLike] });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['contacts', 'boardlike']));
  return { deps, ctx: ctxWith(['contacts.view', 'contacts.manage']) };
}
const person = { kind: 'person' as const, firstName: 'Erika', lastName: 'Beispiel' };
const auditOf = (deps: ReturnType<typeof setup>['deps'], action: string) => deps.db.select().from(schema.auditLog).all().filter((e) => e.action === action);

describe('Rolle mit „vertritt nach § 26 BGB“', () => {
  it('nimmt das Merkmal beim Vergeben an und protokolliert es', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    const after = unwrap(await addContactRole(deps, ctx, { id: contact.id, role: 'board-member', since: '2026-01-01', note: 'Vorsitz', representsAssociation: true }));
    expect(after.roles[0]).toMatchObject({ role: 'board-member', note: 'Vorsitz', representsAssociation: true });
    expect(JSON.parse(auditOf(deps, 'contacts.addRole').at(-1)!.params!)).toMatchObject({ role: 'board-member' });
  });

  it('lehnt das Merkmal an einer Rolle ohne Vertretung ab', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    const res = await addContactRole(deps, ctx, { id: contact.id, role: 'donor', since: '2026-01-01', representsAssociation: true });
    expect(res.ok ? null : res.error).toEqual({ type: 'validation', issues: [{ path: 'representsAssociation', message: 'representationNotAllowed' }] });
  });

  it('ändert Amt und Merkmal; das Protokoll trägt das Merkmal, nie die Notiz', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    const roleId = unwrap(await addContactRole(deps, ctx, { id: contact.id, role: 'board-member', since: '2026-01-01' })).roles[0]!.id;
    const after = unwrap(await updateContactRole(deps, ctx, { roleId, note: 'Schatzmeisterin', representsAssociation: true }));
    expect(after.roles[0]).toMatchObject({ note: 'Schatzmeisterin', representsAssociation: true });
    const entry = auditOf(deps, 'contacts.updateRole').at(-1)!;
    expect(JSON.parse(entry.params!)).toEqual({ role: 'board-member', representsAssociation: true });
    expect(JSON.stringify(entry)).not.toContain('Schatzmeisterin');
  });

  it('lässt beim Ändern Weggelassenes stehen', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    const roleId = unwrap(await addContactRole(deps, ctx, { id: contact.id, role: 'board-member', since: '2026-01-01', note: 'Vorsitz', representsAssociation: true })).roles[0]!.id;
    const after = unwrap(await updateContactRole(deps, ctx, { roleId, note: null }));
    expect(after.roles[0]).toMatchObject({ note: null, representsAssociation: true });
  });

  it('lehnt das Merkmal beim Ändern einer Rolle ohne Vertretung ab', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    const roleId = unwrap(await addContactRole(deps, ctx, { id: contact.id, role: 'donor', since: '2026-01-01' })).roles[0]!.id;
    const res = await updateContactRole(deps, ctx, { roleId, representsAssociation: true });
    expect(res.ok ? null : res.error).toEqual({ type: 'validation', issues: [{ path: 'representsAssociation', message: 'representationNotAllowed' }] });
  });

  it('verlangt contacts.manage', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    const roleId = unwrap(await addContactRole(deps, ctx, { id: contact.id, role: 'board-member', since: '2026-01-01' })).roles[0]!.id;
    const res = await updateContactRole(deps, ctxWith(['contacts.view']), { roleId, note: 'x' });
    expect(res.ok ? null : res.error).toMatchObject({ type: 'forbidden', permission: 'contacts.manage' });
  });

  it('lehnt eine geführte Rolle ab', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    const { startManagedRoleInternal } = await import('../src/managed-roles');
    deps.db.transaction((tx) => startManagedRoleInternal(tx, deps, ctx, { contactId: contact.id, role: 'member', since: '2026-01-01' }));
    const roleId = deps.db.select().from((await import('../src/schema')).contactRoles).all()[0]!.id;
    const res = await updateContactRole(deps, ctx, { roleId, note: 'x' });
    expect(res.ok ? null : res.error).toMatchObject({ type: 'conflict', code: 'roleManagedByModule' });
  });

  it('kennt eine unbekannte Rolle nicht', async () => {
    const { deps, ctx } = setup();
    const res = await updateContactRole(deps, ctx, { roleId: 'NOPE', note: 'x' });
    expect(res.ok ? null : res.error).toMatchObject({ type: 'notFound' });
  });
});
