import { coreModule, defineModule, holdsFor, schema, unwrap, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { endManagedRoleInternal, startManagedRoleInternal } from '../src/managed-roles';
import { contactsModule } from '../src/manifest';
import { contactRoles } from '../src/schema';
import { addContactRole, createContact, endContactRole, updateContactRole } from '../src/service';

/** Ein Modul, das die Rolle `member` selbst führt (Spec Mitglieder § 3.2), daneben eine ungeführte `none`-Rolle. */
const membersLike = defineModule({
  key: 'members',
  version: '1',
  permissions: ['members.read'],
  dependsOn: ['contacts'],
  contactRoles: [
    { key: 'member', retention: 'none', managedBy: 'members' },
    { key: 'donor', retention: 'none' },
  ],
});

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, membersLike] });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['contacts', 'members']));
  return { deps, ctx: ctxWith(['contacts.view', 'contacts.manage']) };
}
const person = { kind: 'person' as const, firstName: 'Erika', lastName: 'Beispiel' };
const roleRows = (deps: ReturnType<typeof setup>['deps'], contactId: string) => deps.db.select().from(contactRoles).where(eq(contactRoles.contactId, contactId)).all();
const auditOf = (deps: ReturnType<typeof setup>['deps'], action: string) => deps.db.select().from(schema.auditLog).all().filter((e) => e.action === action);

describe('a contact role managed by a module', () => {
  it('cannot be added by hand and names the module', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    const res = await addContactRole(deps, ctx, { id: contact.id, role: 'member', since: '2026-01-01' });
    expect(res.ok ? null : res.error).toMatchObject({ type: 'conflict', code: 'roleManagedByModule', messageKey: 'errors.roleManagedByModule', params: { moduleKeys: 'members' } });
    expect(roleRows(deps, contact.id)).toEqual([]);
  });

  it('cannot be ended by hand', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    deps.db.transaction((tx) => startManagedRoleInternal(tx, deps, ctx, { contactId: contact.id, role: 'member', since: '2026-01-01' }));
    const roleId = roleRows(deps, contact.id)[0]!.id;
    const res = await endContactRole(deps, ctx, { roleId, until: '2026-06-30' });
    expect(res.ok ? null : res.error).toMatchObject({ type: 'conflict', code: 'roleManagedByModule' });
    expect(roleRows(deps, contact.id)[0]!.until).toBeNull();
  });

  it('leaves other roles as they are', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    const withRole = unwrap(await addContactRole(deps, ctx, { id: contact.id, role: 'donor', since: '2026-01-01' }));
    unwrap(await endContactRole(deps, ctx, { roleId: withRole.roles[0]!.id, until: '2026-03-31' }));
    expect(roleRows(deps, contact.id).map((r) => [r.role, r.until])).toEqual([['donor', '2026-03-31']]);
  });

  it('starts, ends and reopens through the module, and audits each step', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    deps.db.transaction((tx) => startManagedRoleInternal(tx, deps, ctx, { contactId: contact.id, role: 'member', since: '2026-02-01' }));
    expect(roleRows(deps, contact.id).map((r) => [r.role, r.since, r.until])).toEqual([['member', '2026-02-01', null]]);

    deps.db.transaction((tx) => endManagedRoleInternal(tx, deps, ctx, { contactId: contact.id, role: 'member', until: '2026-12-31' }));
    expect(roleRows(deps, contact.id)[0]!.until).toBe('2026-12-31');

    deps.db.transaction((tx) => endManagedRoleInternal(tx, deps, ctx, { contactId: contact.id, role: 'member', until: null }));
    expect(roleRows(deps, contact.id)[0]!.until).toBeNull();

    const added = auditOf(deps, 'contacts.addRole');
    const ended = auditOf(deps, 'contacts.endRole');
    expect(added).toHaveLength(2); // Beginn und Wiederöffnen
    expect(ended).toHaveLength(1);
    expect(added[0]).toMatchObject({ entityType: 'contact', entityId: contact.id, channel: 'ui' });
    expect(JSON.parse(added[0]!.params!)).toEqual({ role: 'member' });
    expect(ended[0]).toMatchObject({ entityId: contact.id });
    expect(JSON.parse(ended[0]!.params!)).toEqual({ role: 'member' });
  });

  it('a later start after an end adds a new row; ending touches only the latest', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    deps.db.transaction((tx) => {
      startManagedRoleInternal(tx, deps, ctx, { contactId: contact.id, role: 'member', since: '2024-01-01' });
      endManagedRoleInternal(tx, deps, ctx, { contactId: contact.id, role: 'member', until: '2024-12-31' });
      startManagedRoleInternal(tx, deps, ctx, { contactId: contact.id, role: 'member', since: '2026-03-01' });
      endManagedRoleInternal(tx, deps, ctx, { contactId: contact.id, role: 'member', until: '2026-12-31' });
    });
    expect(roleRows(deps, contact.id).map((r) => [r.since, r.until]).sort()).toEqual([['2024-01-01', '2024-12-31'], ['2026-03-01', '2026-12-31']]);
  });

  it('does not give the base period to a contact whose only none-role is managed — its module holds it', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    deps.db.transaction((tx) => {
      startManagedRoleInternal(tx, deps, ctx, { contactId: contact.id, role: 'member', since: '2020-01-01' });
      endManagedRoleInternal(tx, deps, ctx, { contactId: contact.id, role: 'member', until: '2021-12-31' });
    });
    expect(holdsFor(deps, 'contact', contact.id)).toEqual([]);
  });

  it('an unmanaged none-role still brings the base period, as before', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    deps.db.transaction((tx) => startManagedRoleInternal(tx, deps, ctx, { contactId: contact.id, role: 'member', since: '2020-01-01' }));
    unwrap(await addContactRole(deps, ctx, { id: contact.id, role: 'donor', since: '2020-01-01' }));
    expect(holdsFor(deps, 'contact', contact.id).map((h) => h.entity)).toEqual(['contact']);
  });
});

/** Gremien-artig: führt `board-member`, das ein anderes Modul definiert, solange es eingeschaltet ist (Spec Gremien § 3.4). */
const definesBoard = defineModule({ key: 'finance', version: '1', permissions: ['finance.view'], dependsOn: ['contacts'], contactRoles: [{ key: 'board-member', retention: 'none' }] });
/** Zeilen, die das Gremien-artige Modul als seine meldet (wie Gremien die Zeilen einer Amtszeit). */
const ownedRows = new Set<string>();
const governanceLike = defineModule({ key: 'governance', version: '1', permissions: ['governance.read'], dependsOn: ['contacts'], managesContactRoles: ['board-member'], ownsContactRoleRow: (_deps, rowId) => ownedRows.has(rowId) });

function setupBoard(enabled: string[]) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, definesBoard, governanceLike] });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', enabled));
  return { deps, ctx: ctxWith(['contacts.view', 'contacts.manage']) };
}

describe('a contact role managed by another module while it is enabled', () => {
  it('cannot be added by hand while the managing module is on, and can again once it is off', async () => {
    const { deps, ctx } = setupBoard(['contacts', 'finance', 'governance']);
    const contact = unwrap(await createContact(deps, ctx, person));
    const res = await addContactRole(deps, ctx, { id: contact.id, role: 'board-member', since: '2026-01-01' });
    expect(res.ok ? null : res.error).toMatchObject({ type: 'conflict', code: 'roleManagedByModule', params: { moduleKeys: 'governance' } });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['contacts', 'finance']));
    expect((await addContactRole(deps, ctx, { id: contact.id, role: 'board-member', since: '2026-01-01' })).ok).toBe(true);
  });

  it('cannot be ended or changed by hand while the managing module is on and owns the row', async () => {
    const { deps, ctx } = setupBoard(['contacts', 'finance', 'governance']);
    const contact = unwrap(await createContact(deps, ctx, person));
    deps.db.transaction((tx) => startManagedRoleInternal(tx, deps, ctx, { contactId: contact.id, role: 'board-member', since: '2026-01-01' }));
    const rowId = roleRows(deps, contact.id)[0]!.id;
    ownedRows.add(rowId);
    const res = await endContactRole(deps, ctx, { roleId: rowId, until: '2026-06-30' });
    expect(res.ok ? null : res.error).toMatchObject({ code: 'roleManagedByModule' });
    const upd = await updateContactRole(deps, ctx, { roleId: rowId, note: 'Kasse' });
    expect(upd.ok ? null : upd.error).toMatchObject({ code: 'roleManagedByModule' });
  });

  it('V-1: a row from before the managing module (it does not own it) can still be ended and changed by hand', async () => {
    const { deps, ctx } = setupBoard(['contacts', 'finance']);
    const contact = unwrap(await createContact(deps, ctx, person));
    unwrap(await addContactRole(deps, ctx, { id: contact.id, role: 'board-member', since: '2023-01-01', note: 'Vorsitz' }));
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['contacts', 'finance', 'governance']));
    const rowId = roleRows(deps, contact.id)[0]!.id;
    unwrap(await updateContactRole(deps, ctx, { roleId: rowId, note: 'Beisitz' }));
    unwrap(await endContactRole(deps, ctx, { roleId: rowId, until: '2026-06-30' }));
    expect(roleRows(deps, contact.id)[0]).toMatchObject({ until: '2026-06-30', note: 'Beisitz' });
    const again = await addContactRole(deps, ctx, { id: contact.id, role: 'board-member', since: '2026-07-01' });
    expect(again.ok ? null : again.error).toMatchObject({ code: 'roleManagedByModule' });
  });

  it('does not bring the base period while managed; without the managing module it does, as before', async () => {
    const on = setupBoard(['contacts', 'finance', 'governance']);
    const a = unwrap(await createContact(on.deps, on.ctx, person));
    on.deps.db.transaction((tx) => startManagedRoleInternal(tx, on.deps, on.ctx, { contactId: a.id, role: 'board-member', since: '2020-01-01' }));
    expect(holdsFor(on.deps, 'contact', a.id)).toEqual([]);
    const off = setupBoard(['contacts', 'finance']);
    const b = unwrap(await createContact(off.deps, off.ctx, person));
    unwrap(await addContactRole(off.deps, off.ctx, { id: b.id, role: 'board-member', since: '2020-01-01' }));
    expect(holdsFor(off.deps, 'contact', b.id).map((h) => h.entity)).toEqual(['contact']);
  });
});
