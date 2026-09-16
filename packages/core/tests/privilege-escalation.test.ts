import { describe, expect, it } from 'vitest';
import { getEffectivePermissions } from '../src/roles/effective';
import { assignRole, createRole, listRoles, removeRole, setRolePermissions } from '../src/roles/service';
import { type Result, unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertRole, insertUser, type TestDeps } from '../src/testing';
import { createUser, listUsers, resetStartPassword, setUserActive, updateUser } from '../src/users/service';

/**
 * Niemand vergibt Rechte, die er selbst nicht hat — und niemand verfügt über
 * ein Konto, das mehr Rechte hat als er selbst. Vorher genügte `users.manage`,
 * um sich über vier Wege die geschützte Rolle zu verschaffen (Release-Prüfung S7).
 */

const insufficient = (result: Result<unknown>): boolean =>
  result.ok === false && result.error.type === 'conflict' && result.error.code === 'insufficientPrivileges';

/** „Macht die Zugänge“, aber ist nicht Administrator. */
const gatekeeper = ctxWith(['users.manage', 'roles.manage'], 'GATEKEEPER');

function allPermissions(deps: TestDeps, userId = 'ADMIN') {
  return ctxWith([...deps.registry.permissionKeys], userId);
}

function withAdministrator(deps: TestDeps) {
  const adminRoleId = insertRole(deps, { name: 'Administration', isProtected: true });
  const adminId = insertUser(deps, { email: 'anna@example.org' });
  return { adminRoleId, adminId };
}

async function assignAsAdministrator(deps: TestDeps, userId: string, roleId: string) {
  unwrap(await assignRole(deps, allPermissions(deps), { userId, roleId }));
}

describe('Rechteausweitung', () => {
  it('assignRole: die geschützte Rolle vergibt nur, wer alle Rechte hat', async () => {
    const deps = createTestDeps();
    const { adminRoleId } = withAdministrator(deps);
    const self = insertUser(deps, { id: 'GATEKEEPER', email: 'gate@example.org' });
    expect(insufficient(await assignRole(deps, gatekeeper, { userId: self, roleId: adminRoleId }))).toBe(true);
    expect(getEffectivePermissions(deps.db, deps.registry, self).size).toBe(0);
  });

  it('assignRole: eine Rolle mit Rechten, die man selbst nicht hat, ist gesperrt; eine kleinere nicht', async () => {
    const deps = createTestDeps();
    const target = insertUser(deps, { email: 'mira@example.org' });
    const bigger = unwrap(await createRole(deps, allPermissions(deps), { name: 'Mehr' }));
    unwrap(await setRolePermissions(deps, allPermissions(deps), { roleId: bigger.id, permissionKeys: ['users.manage', 'backup.import'] }));
    expect(insufficient(await assignRole(deps, gatekeeper, { userId: target, roleId: bigger.id }))).toBe(true);
    const smaller = unwrap(await createRole(deps, allPermissions(deps), { name: 'Weniger' }));
    unwrap(await setRolePermissions(deps, allPermissions(deps), { roleId: smaller.id, permissionKeys: ['users.manage'] }));
    expect((await assignRole(deps, gatekeeper, { userId: target, roleId: smaller.id })).ok).toBe(true);
  });

  it('createUser: kein neues Konto mit einer Rolle, die man nicht vergeben darf', async () => {
    const deps = createTestDeps();
    const { adminRoleId } = withAdministrator(deps);
    const result = await createUser(deps, gatekeeper, { name: 'Strohmann', email: 'stroh@example.org', roleIds: [adminRoleId] });
    expect(insufficient(result)).toBe(true);
    expect((await createUser(deps, gatekeeper, { name: 'Neu', email: 'neu@example.org', roleIds: [] })).ok).toBe(true);
  });

  it('resetStartPassword: nicht für ein Konto mit mehr Rechten', async () => {
    const deps = createTestDeps();
    const { adminRoleId, adminId } = withAdministrator(deps);
    await assignAsAdministrator(deps, adminId, adminRoleId);
    expect(insufficient(await resetStartPassword(deps, gatekeeper, { id: adminId }))).toBe(true);
    const plain = insertUser(deps, { email: 'plain@example.org' });
    expect((await resetStartPassword(deps, gatekeeper, { id: plain })).ok).toBe(true);
  });

  it('setRolePermissions: nur Rechte hinzufügen, die man selbst hat; Entfernen und Behalten bleibt frei', async () => {
    const deps = createTestDeps();
    const role = unwrap(await createRole(deps, allPermissions(deps), { name: 'Kasse' }));
    unwrap(await setRolePermissions(deps, allPermissions(deps), { roleId: role.id, permissionKeys: ['audit.view', 'backup.import'] }));
    const adding = await setRolePermissions(deps, gatekeeper, { roleId: role.id, permissionKeys: ['audit.view', 'backup.import', 'settings.manage'] });
    expect(insufficient(adding)).toBe(true);
    const keeping = await setRolePermissions(deps, gatekeeper, { roleId: role.id, permissionKeys: ['backup.import', 'users.manage'] });
    expect(keeping.ok && keeping.value.permissionKeys).toEqual(['backup.import', 'users.manage']);
  });

  it('auch Ändern, Deaktivieren und Rolle-Entziehen gelten nicht für ein Konto mit mehr Rechten', async () => {
    const deps = createTestDeps();
    const { adminRoleId, adminId } = withAdministrator(deps);
    await assignAsAdministrator(deps, adminId, adminRoleId);
    const second = insertUser(deps, { email: 'jonas@example.org' });
    await assignAsAdministrator(deps, second, adminRoleId);
    expect(insufficient(await updateUser(deps, gatekeeper, { id: adminId, name: 'Anna', email: 'gate@example.org' }))).toBe(true);
    expect(insufficient(await setUserActive(deps, gatekeeper, { id: adminId, isActive: false }))).toBe(true);
    expect(insufficient(await removeRole(deps, gatekeeper, { userId: adminId, roleId: adminRoleId }))).toBe(true);
  });

  it('Gegenprobe: Administratoren helfen einander weiterhin bei allem', async () => {
    const deps = createTestDeps();
    const { adminRoleId, adminId } = withAdministrator(deps);
    await assignAsAdministrator(deps, adminId, adminRoleId);
    const other = insertUser(deps, { email: 'jonas@example.org' });
    const admin = allPermissions(deps, adminId);
    unwrap(await assignRole(deps, admin, { userId: other, roleId: adminRoleId }));
    unwrap(await resetStartPassword(deps, admin, { id: other }));
    unwrap(await updateUser(deps, admin, { id: other, name: 'Jonas', email: 'jonas@example.org' }));
    unwrap(await createUser(deps, admin, { name: 'Dritte', email: 'dritte@example.org', roleIds: [adminRoleId] }));
    unwrap(await removeRole(deps, admin, { userId: other, roleId: adminRoleId }));
  });

  it('ein Rechteschlüssel, den kein Modul mehr kennt, sperrt niemanden', async () => {
    const deps = createTestDeps();
    const target = insertUser(deps, { email: 'mira@example.org' });
    const role = unwrap(await createRole(deps, allPermissions(deps), { name: 'Alt' }));
    unwrap(await setRolePermissions(deps, allPermissions(deps), { roleId: role.id, permissionKeys: ['users.manage'] }));
    deps.sqlite.prepare("insert into role_permissions (role_id, permission_key) values (?, 'removed.module')").run(role.id);
    expect((await assignRole(deps, gatekeeper, { userId: target, roleId: role.id })).ok).toBe(true);
  });

  it('die Listen sagen, welche Rolle man vergeben und über welches Konto man verfügen darf', async () => {
    const deps = createTestDeps();
    const { adminRoleId, adminId } = withAdministrator(deps);
    await assignAsAdministrator(deps, adminId, adminRoleId);
    const small = unwrap(await createRole(deps, allPermissions(deps), { name: 'Zugänge' }));
    unwrap(await setRolePermissions(deps, allPermissions(deps), { roleId: small.id, permissionKeys: ['users.manage'] }));
    const plain = insertUser(deps, { email: 'plain@example.org' });

    const roles = unwrap(await listRoles(deps, gatekeeper));
    expect(Object.fromEntries(roles.map((r) => [r.id, r.grantable]))).toEqual({ [adminRoleId]: false, [small.id]: true });
    const users = unwrap(await listUsers(deps, gatekeeper));
    expect(Object.fromEntries(users.map((u) => [u.id, u.controllable]))).toEqual({ [adminId]: false, [plain]: true });

    expect(unwrap(await listRoles(deps, allPermissions(deps))).every((r) => r.grantable)).toBe(true);
    expect(unwrap(await listUsers(deps, allPermissions(deps))).every((u) => u.controllable)).toBe(true);
  });
});
