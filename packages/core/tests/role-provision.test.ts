import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { rolePermissions, roles } from '../src/db/schema';
import { createRoleInternal, roleIdByOrigin } from '../src/roles/provision';
import { auditEntry, createTestDeps, insertRole, systemContext } from '../src/testing';

const ROLE = { module: 'demo', originKey: 'demo:clerk', name: 'Erfasser', permissions: ['users.manage', 'not.a.permission'] };
const run = (deps: ReturnType<typeof createTestDeps>, role = ROLE) => deps.db.transaction((tx) => createRoleInternal(tx, deps, systemContext(), role));

describe('createRoleInternal', () => {
  it('creates the role with the permissions the registry knows, and records it', () => {
    const deps = createTestDeps();
    expect(run(deps)).toBe('created');
    const id = roleIdByOrigin(deps.db, 'demo:clerk')!;
    const keys = deps.db.select().from(rolePermissions).where(eq(rolePermissions.roleId, id)).all().map((r) => r.permissionKey);
    expect(keys).toEqual(['users.manage']);
    const entry = auditEntry(deps, 'roles.provision');
    expect(entry.channel).toBe('system');
  });

  it('never comes back after renaming and never refills permissions', () => {
    const deps = createTestDeps();
    run(deps);
    const id = roleIdByOrigin(deps.db, 'demo:clerk')!;
    deps.db.update(roles).set({ name: 'Helferin' }).where(eq(roles.id, id)).run();
    deps.db.delete(rolePermissions).where(eq(rolePermissions.roleId, id)).run();
    expect(run(deps)).toBe('already');
    expect(deps.db.select().from(roles).all().filter((r) => r.originKey === 'demo:clerk')).toHaveLength(1);
    expect(deps.db.select().from(rolePermissions).where(eq(rolePermissions.roleId, id)).all()).toHaveLength(0);
  });

  it('skips when the name is taken — case-insensitively — and still counts as delivered', () => {
    const deps = createTestDeps();
    insertRole(deps, { name: 'erfasser' });
    expect(run(deps)).toBe('skipped');
    expect(roleIdByOrigin(deps.db, 'demo:clerk')).toBeNull();
    expect(run(deps)).toBe('already');
  });
});
