import { describe, expect, it } from 'vitest';
import { auditLog } from '../src/db/schema';
import { countActiveProtectedHolders, getEffectivePermissions } from '../src/roles/effective';
import { assignRole, createRole, listRoles, removeRole, setRolePermissions, updateRole } from '../src/roles/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertRole, insertUser } from '../src/testing';

const admin = ctxWith(['roles.manage', 'users.manage']);

describe('roles service', () => {
  it('creates a role with no permissions and audits it', async () => {
    const deps = createTestDeps();
    const role = unwrap(await createRole(deps, admin, { name: 'Schatzmeisterin', description: 'Finanzen' }));
    expect(role).toMatchObject({ name: 'Schatzmeisterin', description: 'Finanzen', isProtected: false, permissionKeys: [], userCount: 0 });
    expect(deps.db.select().from(auditLog).all()[0]).toMatchObject({ action: 'roles.create', entityType: 'role', entityId: role.id });
  });

  it('rejects duplicate names, empty names and missing permission', async () => {
    const deps = createTestDeps();
    unwrap(await createRole(deps, admin, { name: 'Kassenprüfer' }));
    const dup = await createRole(deps, admin, { name: 'kassenprüfer ' });
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'roleNameTaken').toBe(true);
    const empty = await createRole(deps, admin, { name: '  ' });
    expect(empty.ok === false && empty.error.type === 'validation').toBe(true);
    const denied = await createRole(deps, ctxWith(['users.manage']), { name: 'X' });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });

  it('sets permissions, rejects unknown keys, audits before/after', async () => {
    const deps = createTestDeps();
    const role = unwrap(await createRole(deps, admin, { name: 'Kassenprüfer' }));
    const updated = unwrap(await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: ['documents.export', 'audit.view'] }));
    expect(updated.permissionKeys).toEqual(['audit.view', 'documents.export']);
    const bad = await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: ['finance.magic'] });
    expect(bad.ok === false && bad.error.type === 'validation' && bad.error.issues[0]?.path === 'permissionKeys.0').toBe(true);
    const entries = deps.db.select().from(auditLog).all();
    expect(entries.at(-1)).toMatchObject({ action: 'roles.setPermissions', before: '[]', after: '["audit.view","documents.export"]' });
  });

  it('protected roles cannot be edited or re-permissioned', async () => {
    const deps = createTestDeps();
    const roleId = insertRole(deps, { name: 'Administration', isProtected: true });
    const role = unwrap(await listRoles(deps, admin)).find((r) => r.id === roleId)!;
    expect(role.isProtected).toBe(true);
    const edit = await updateRole(deps, admin, { id: role.id, name: 'Admin' });
    expect(edit.ok === false && edit.error.type === 'conflict' && edit.error.code === 'roleProtected').toBe(true);
    const perms = await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: [] });
    expect(perms.ok === false && perms.error.type === 'conflict').toBe(true);
  });

  it('assigns and removes roles; effective permissions are the union, protected means all', async () => {
    const deps = createTestDeps();
    const userId = insertUser(deps, { email: 'mira@example.org' });
    const a = unwrap(await createRole(deps, admin, { name: 'A' }));
    const b = unwrap(await createRole(deps, admin, { name: 'B' }));
    unwrap(await setRolePermissions(deps, admin, { roleId: a.id, permissionKeys: ['audit.view'] }));
    unwrap(await setRolePermissions(deps, admin, { roleId: b.id, permissionKeys: ['documents.export'] }));
    unwrap(await assignRole(deps, admin, { userId, roleId: a.id }));
    unwrap(await assignRole(deps, admin, { userId, roleId: b.id }));
    expect([...getEffectivePermissions(deps.db, deps.registry, userId)].sort()).toEqual(['audit.view', 'documents.export']);
    unwrap(await removeRole(deps, admin, { userId, roleId: b.id }));
    expect([...getEffectivePermissions(deps.db, deps.registry, userId)]).toEqual(['audit.view']);

    const adminRoleId = insertRole(deps, { name: 'Administration', isProtected: true });
    unwrap(await assignRole(deps, admin, { userId, roleId: adminRoleId }));
    expect(getEffectivePermissions(deps.db, deps.registry, userId).size).toBe(deps.registry.permissionKeys.size);
    expect(countActiveProtectedHolders(deps.db)).toBe(1);
  });

  it('refuses to remove the protected role from its last active holder', async () => {
    const deps = createTestDeps();
    const only = insertUser(deps, { email: 'anna@example.org' });
    const adminRoleId = insertRole(deps, { name: 'Administration', isProtected: true });
    unwrap(await assignRole(deps, admin, { userId: only, roleId: adminRoleId }));
    const result = await removeRole(deps, admin, { userId: only, roleId: adminRoleId });
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code === 'lastAdministrator').toBe(true);
    const second = insertUser(deps, { email: 'jonas@example.org' });
    unwrap(await assignRole(deps, admin, { userId: second, roleId: adminRoleId }));
    expect((await removeRole(deps, admin, { userId: only, roleId: adminRoleId })).ok).toBe(true);
  });

  it('lists roles with permission keys and user counts for users.manage or roles.manage', async () => {
    const deps = createTestDeps();
    const userId = insertUser(deps, {});
    const role = unwrap(await createRole(deps, admin, { name: 'A' }));
    unwrap(await assignRole(deps, admin, { userId, roleId: role.id }));
    const list = unwrap(await listRoles(deps, ctxWith(['users.manage'])));
    expect(list).toEqual([expect.objectContaining({ name: 'A', userCount: 1 })]);
    expect((await listRoles(deps, ctxWith(['audit.view']))).ok).toBe(false);
  });
});
