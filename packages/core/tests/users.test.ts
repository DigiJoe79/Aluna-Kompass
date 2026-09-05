import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { START_PASSWORD_PATTERN, verifyPassword } from '../src/auth/password';
import { auditLog, sessions, users } from '../src/db/schema';
import { assignRole, createRole } from '../src/roles/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertRole, insertUser } from '../src/testing';
import { createUser, listUsers, resetStartPassword, setUserActive, updateUser } from '../src/users/service';

const admin = ctxWith(['users.manage', 'roles.manage']);

describe('users service', () => {
  it('creates a user with a one-time start password, assigned roles and an audit entry without secrets', async () => {
    const deps = createTestDeps();
    const role = unwrap(await createRole(deps, admin, { name: 'Kassenprüfer' }));
    const { user, startPassword } = unwrap(
      await createUser(deps, admin, { name: 'Peter Lang', email: 'Peter.Lang@Example.org', roleIds: [role.id] }),
    );
    expect(startPassword).toMatch(START_PASSWORD_PATTERN);
    expect(user).toMatchObject({ name: 'Peter Lang', email: 'peter.lang@example.org', status: 'firstLoginPending', mustChangePassword: true, roles: [{ id: role.id, name: 'Kassenprüfer' }] });
    const row = deps.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(await verifyPassword(row!.passwordHash, startPassword)).toBe(true);
    const audit = deps.db.select().from(auditLog).all().find((e) => e.action === 'users.create');
    expect(audit?.after).not.toContain(startPassword);
    expect(audit?.after).not.toContain('passwordHash');
  });

  it('rejects duplicate emails (case-insensitive), invalid emails, unknown roles and missing permission', async () => {
    const deps = createTestDeps();
    insertUser(deps, { email: 'anna@example.org' });
    const dup = await createUser(deps, admin, { name: 'A', email: 'ANNA@example.org', roleIds: [] });
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'emailTaken').toBe(true);
    const bad = await createUser(deps, admin, { name: 'A', email: 'nope', roleIds: [] });
    expect(bad.ok === false && bad.error.type === 'validation').toBe(true);
    const role = await createUser(deps, admin, { name: 'A', email: 'b@example.org', roleIds: ['missing'] });
    expect(role.ok === false && role.error.type === 'notFound').toBe(true);
    const denied = await createUser(deps, ctxWith(['roles.manage']), { name: 'A', email: 'c@example.org', roleIds: [] });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });

  it('lists users with derived status', async () => {
    const deps = createTestDeps();
    insertUser(deps, { name: 'Aktiv', email: 'a@example.org' });
    insertUser(deps, { name: 'Inaktiv', email: 'i@example.org', isActive: false });
    unwrap(await createUser(deps, admin, { name: 'Neu', email: 'n@example.org', roleIds: [] }));
    const list = unwrap(await listUsers(deps, admin));
    expect(list.map((u) => [u.name, u.status])).toEqual([
      ['Aktiv', 'active'],
      ['Inaktiv', 'inactive'],
      ['Neu', 'firstLoginPending'],
    ]);
  });

  it('updates name and email with audit diff', async () => {
    const deps = createTestDeps();
    const id = insertUser(deps, { name: 'Alt', email: 'alt@example.org' });
    const updated = unwrap(await updateUser(deps, admin, { id, name: 'Neu', email: 'neu@example.org' }));
    expect(updated).toMatchObject({ name: 'Neu', email: 'neu@example.org' });
    const entry = deps.db.select().from(auditLog).all().at(-1);
    expect(entry).toMatchObject({ action: 'users.update', entityId: id });
    expect(JSON.parse(entry!.before!)).toMatchObject({ name: 'Alt' });
    expect(JSON.parse(entry!.after!)).toMatchObject({ name: 'Neu' });
  });

  it('deactivation revokes sessions and refuses for the last active administrator', async () => {
    const deps = createTestDeps();
    const id = insertUser(deps, { email: 'anna@example.org' });
    deps.db.insert(sessions).values({ id: 'S1', userId: id, createdAt: 'x', expiresAt: '2099-01-01T00:00:00.000Z' }).run();
    const adminRoleId = insertRole(deps, { name: 'Administration', isProtected: true });
    unwrap(await assignRole(deps, admin, { userId: id, roleId: adminRoleId }));
    const refused = await setUserActive(deps, admin, { id, isActive: false });
    expect(refused.ok === false && refused.error.type === 'conflict' && refused.error.code === 'lastAdministrator').toBe(true);
    const second = insertUser(deps, { email: 'jonas@example.org' });
    unwrap(await assignRole(deps, admin, { userId: second, roleId: adminRoleId }));
    const done = unwrap(await setUserActive(deps, admin, { id, isActive: false }));
    expect(done.status).toBe('inactive');
    expect(deps.db.select().from(sessions).all()).toHaveLength(0);
  });

  it('resetStartPassword issues a new word chain, forces a change and revokes sessions', async () => {
    const deps = createTestDeps();
    const id = insertUser(deps, {});
    deps.db.insert(sessions).values({ id: 'S1', userId: id, createdAt: 'x', expiresAt: '2099-01-01T00:00:00.000Z' }).run();
    const { startPassword } = unwrap(await resetStartPassword(deps, admin, { id }));
    expect(startPassword).toMatch(START_PASSWORD_PATTERN);
    const row = deps.db.select().from(users).where(eq(users.id, id)).get();
    expect(row?.mustChangePassword).toBe(true);
    expect(await verifyPassword(row!.passwordHash, startPassword)).toBe(true);
    expect(deps.db.select().from(sessions).all()).toHaveLength(0);
  });
});
