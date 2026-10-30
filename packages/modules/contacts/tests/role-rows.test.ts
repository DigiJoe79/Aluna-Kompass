import { coreModule, defineModule, schema, unwrap, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { endRoleRowInternal, setRoleRowRepresentationInternal, startRoleRowInternal } from '../src/role-rows';
import { contactRoles } from '../src/schema';
import { createContact } from '../src/service';

/** Ein Modul, das Vorstandsrollen aus Ämtern setzt (Spec Gremien § 3.4). */
const boardLike = defineModule({ key: 'boardlike', version: '1', permissions: ['boardlike.read'], dependsOn: ['contacts'], contactRoles: [{ key: 'board-member', retention: 'none' }] });

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, boardLike] });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['contacts', 'boardlike']));
  return { deps, ctx: ctxWith(['contacts.view', 'contacts.manage']) };
}
type D = ReturnType<typeof setup>['deps'];
const rows = (deps: D, contactId: string) => deps.db.select().from(contactRoles).where(eq(contactRoles.contactId, contactId)).all();
const auditOf = (deps: D, action: string) => deps.db.select().from(schema.auditLog).all().filter((e) => e.action === action);

describe('role rows for leading modules', () => {
  it('starts a row with a note, returns its id and audits contacts.addRole', async () => {
    const { deps, ctx } = setup();
    const contactId = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' })).id;
    const id = deps.db.transaction((tx) => startRoleRowInternal(tx, deps, ctx, { contactId, role: 'board-member', since: '2026-07-20', note: 'Vorsitzende' }));
    expect(rows(deps, contactId)).toEqual([expect.objectContaining({ id, role: 'board-member', since: '2026-07-20', until: null, note: 'Vorsitzende' })]);
    expect(auditOf(deps, 'contacts.addRole').map((e) => JSON.parse(e.params!))).toEqual([{ role: 'board-member' }]);
  });

  it('writes and audits "represents the association" when asked to', async () => {
    const { deps, ctx } = setup();
    const contactId = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' })).id;
    const id = deps.db.transaction((tx) => startRoleRowInternal(tx, deps, ctx, { contactId, role: 'board-member', since: '2026-07-20', note: 'Vorsitz', representsAssociation: true }));
    expect(rows(deps, contactId).find((r) => r.id === id)?.representsAssociation).toBe(true);
    expect(JSON.parse(auditOf(deps, 'contacts.addRole')[0]!.after!)).toMatchObject({ role: 'board-member', representsAssociation: true });
  });

  it('ends exactly the row it is given, not the youngest of the role', async () => {
    const { deps, ctx } = setup();
    const contactId = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' })).id;
    const older = deps.db.transaction((tx) => startRoleRowInternal(tx, deps, ctx, { contactId, role: 'board-member', since: '2026-07-20', note: 'Kasse' }));
    const younger = deps.db.transaction((tx) => startRoleRowInternal(tx, deps, ctx, { contactId, role: 'board-member', since: '2027-03-01', note: 'Vorsitz' }));
    deps.db.transaction((tx) => endRoleRowInternal(tx, deps, ctx, { rowId: older, until: '2027-02-28' }));
    const byId = new Map(rows(deps, contactId).map((r) => [r.id, r]));
    expect(byId.get(older)?.until).toBe('2027-02-28');
    expect(byId.get(younger)?.until).toBeNull();
    expect(auditOf(deps, 'contacts.endRole')).toHaveLength(1);
  });

  it('reopens a row with until null and audits it as a start', async () => {
    const { deps, ctx } = setup();
    const contactId = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' })).id;
    const id = deps.db.transaction((tx) => startRoleRowInternal(tx, deps, ctx, { contactId, role: 'board-member', since: '2026-07-20', note: null }));
    deps.db.transaction((tx) => endRoleRowInternal(tx, deps, ctx, { rowId: id, until: '2026-12-31' }));
    deps.db.transaction((tx) => endRoleRowInternal(tx, deps, ctx, { rowId: id, until: null }));
    expect(rows(deps, contactId)[0]?.until).toBeNull();
    expect(auditOf(deps, 'contacts.addRole')).toHaveLength(2);
  });

  it('switches "represents the association" on a running row and audits contacts.updateRole', async () => {
    const { deps, ctx } = setup(); // TEST_NOW 2026-09-05
    const contactId = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' })).id;
    const open = deps.db.transaction((tx) => startRoleRowInternal(tx, deps, ctx, { contactId, role: 'board-member', since: '2026-07-20', note: 'Vorsitz' }));
    const endsLater = deps.db.transaction((tx) => startRoleRowInternal(tx, deps, ctx, { contactId, role: 'board-member', since: '2026-07-20', note: 'Kasse' }));
    deps.db.transaction((tx) => endRoleRowInternal(tx, deps, ctx, { rowId: endsLater, until: '2026-12-31' }));
    deps.db.transaction((tx) => setRoleRowRepresentationInternal(tx, deps, ctx, { rowId: open, representsAssociation: true }));
    deps.db.transaction((tx) => setRoleRowRepresentationInternal(tx, deps, ctx, { rowId: endsLater, representsAssociation: true }));
    expect(rows(deps, contactId).every((r) => r.representsAssociation)).toBe(true);
    const updates = auditOf(deps, 'contacts.updateRole');
    expect(updates).toHaveLength(2);
    expect(JSON.parse(updates[0]!.before!)).toMatchObject({ role: 'board-member', representsAssociation: false });
    expect(JSON.parse(updates[0]!.after!)).toMatchObject({ role: 'board-member', representsAssociation: true });
  });

  it('refuses to switch it on an ended row — a programming error', async () => {
    const { deps, ctx } = setup();
    const contactId = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' })).id;
    const id = deps.db.transaction((tx) => startRoleRowInternal(tx, deps, ctx, { contactId, role: 'board-member', since: '2025-07-20', note: null }));
    deps.db.transaction((tx) => endRoleRowInternal(tx, deps, ctx, { rowId: id, until: '2026-01-31' }));
    expect(() => deps.db.transaction((tx) => setRoleRowRepresentationInternal(tx, deps, ctx, { rowId: id, representsAssociation: true }))).toThrow();
  });

  it('throws on an unknown row', () => {
    const { deps, ctx } = setup();
    expect(() => deps.db.transaction((tx) => endRoleRowInternal(tx, deps, ctx, { rowId: 'nope', until: '2026-12-31' }))).toThrow();
  });
});
