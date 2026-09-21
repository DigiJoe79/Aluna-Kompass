import { describe, expect, it } from 'vitest';
import { CORE_PERMISSIONS } from '../src/permissions/core';
import { listUserNamesWithPermission } from '../src/roles/effective';
import { assignRole, createRole, setRolePermissions } from '../src/roles/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const admin = ctxWith(CORE_PERMISSIONS);

describe('listUserNamesWithPermission', () => {
  it('names active users holding the permission, alphabetically, without email', async () => {
    const deps = createTestDeps();
    const role = unwrap(await createRole(deps, admin, { name: 'Prüferin' }));
    unwrap(await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: ['audit.view'] }));
    const zoe = insertUser(deps, { name: 'Zoe Beispiel', email: 'zoe@example.org' });
    const anna = insertUser(deps, { name: 'Anna Muster', email: 'anna@example.org' });
    unwrap(await assignRole(deps, admin, { userId: zoe, roleId: role.id }));
    unwrap(await assignRole(deps, admin, { userId: anna, roleId: role.id }));

    const names = listUserNamesWithPermission(deps, 'audit.view');
    expect(names).toEqual(['Anna Muster', 'Zoe Beispiel']);
    expect(names.join(' ')).not.toContain('@');
  });

  it('leaves out inactive users and users without the permission', async () => {
    const deps = createTestDeps();
    const withRole = unwrap(await createRole(deps, admin, { name: 'Mit Recht' }));
    unwrap(await setRolePermissions(deps, admin, { roleId: withRole.id, permissionKeys: ['audit.view'] }));
    const withoutRole = unwrap(await createRole(deps, admin, { name: 'Ohne Recht' }));

    const inactive = insertUser(deps, { name: 'Ida Inaktiv', isActive: false });
    unwrap(await assignRole(deps, admin, { userId: inactive, roleId: withRole.id }));
    const other = insertUser(deps, { name: 'Otto Anders' });
    unwrap(await assignRole(deps, admin, { userId: other, roleId: withoutRole.id }));

    expect(listUserNamesWithPermission(deps, 'audit.view')).toEqual([]);
  });
});
