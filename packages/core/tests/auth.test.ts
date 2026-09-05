import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { changeOwnPassword, LOCK_MINUTES, login, MAX_FAILED_LOGINS } from '../src/auth/login';
import { hashPassword } from '../src/auth/password';
import { resolveSession, revokeSession } from '../src/auth/sessions';
import { auditLog, sessions, users } from '../src/db/schema';
import { assignRole, createRole, setRolePermissions } from '../src/roles/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const meta = { ipAddress: '10.0.0.5', requestId: 'REQ-1' };
const PASSWORD = 'wiese-kanu-73-lampe';

async function userWithPassword(deps: ReturnType<typeof createTestDeps>, overrides: Parameters<typeof insertUser>[1] = {}) {
  return insertUser(deps, { email: 'anna@example.org', passwordHash: await hashPassword(PASSWORD), ...overrides });
}

describe('login and sessions', () => {
  it('logs in with correct credentials, creates a session and resolves it to a context with effective permissions', async () => {
    const deps = createTestDeps();
    const userId = await userWithPassword(deps);
    const admin = ctxWith(['roles.manage', 'users.manage']);
    const role = unwrap(await createRole(deps, admin, { name: 'Prüfer' }));
    unwrap(await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: ['audit.view'] }));
    unwrap(await assignRole(deps, admin, { userId, roleId: role.id }));

    const result = unwrap(await login(deps, { email: 'Anna@Example.org', password: PASSWORD, ...meta }));
    expect(result.userId).toBe(userId);
    expect(result.mustChangePassword).toBe(false);

    const resolved = resolveSession(deps, result.sessionId, meta);
    expect(resolved?.ctx).toMatchObject({ userId, channel: 'ui', ipAddress: '10.0.0.5', requestId: 'REQ-1', apiTokenId: null });
    expect([...resolved!.ctx.permissions]).toEqual(['audit.view']);
    expect(deps.db.select().from(users).where(eq(users.id, userId)).get()?.lastLoginAt).toBe('2026-09-05T08:00:00.000Z');
    expect(deps.db.select().from(auditLog).all().some((e) => e.action === 'auth.login' && e.userId === userId)).toBe(true);
  });

  it('returns invalidCredentials with attempts left and locks after five failures with a system audit entry', async () => {
    const deps = createTestDeps();
    const userId = await userWithPassword(deps);
    for (let attempt = 1; attempt < MAX_FAILED_LOGINS; attempt += 1) {
      const r = await login(deps, { email: 'anna@example.org', password: 'falsch-falsch-00-falsch', ...meta });
      expect(r.ok === false && r.error.type === 'unauthorized' && r.error.reason === 'invalidCredentials' && r.error.attemptsLeft === MAX_FAILED_LOGINS - attempt).toBe(true);
    }
    const fifth = await login(deps, { email: 'anna@example.org', password: 'falsch-falsch-00-falsch', ...meta });
    expect(fifth.ok === false && fifth.error.type === 'unauthorized' && fifth.error.reason === 'locked').toBe(true);
    const locked = deps.db.select().from(auditLog).all().find((e) => e.action === 'auth.locked');
    expect(locked).toMatchObject({ channel: 'system', userId: null, entityType: 'user', entityId: userId });

    const stillLocked = await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta });
    expect(stillLocked.ok === false && stillLocked.error.type === 'unauthorized' && stillLocked.error.reason === 'locked').toBe(true);

    deps.clock.advance((LOCK_MINUTES + 1) * 60_000);
    expect((await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta })).ok).toBe(true);
  });

  it('does not reveal whether an email exists and refuses inactive users', async () => {
    const deps = createTestDeps();
    const unknown = await login(deps, { email: 'nobody@example.org', password: PASSWORD, ...meta });
    expect(unknown.ok === false && unknown.error.type === 'unauthorized' && unknown.error.reason === 'invalidCredentials' && unknown.error.attemptsLeft === undefined).toBe(true);
    await userWithPassword(deps, { isActive: false });
    const inactive = await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta });
    expect(inactive.ok === false && inactive.error.type === 'unauthorized' && inactive.error.reason === 'inactive').toBe(true);
  });

  it('expired or revoked sessions do not resolve', async () => {
    const deps = createTestDeps();
    await userWithPassword(deps);
    const { sessionId } = unwrap(await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta }));
    deps.clock.advance(15 * 24 * 60 * 60 * 1000);
    expect(resolveSession(deps, sessionId, meta)).toBeNull();
    const again = unwrap(await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta }));
    revokeSession(deps, again.sessionId);
    expect(resolveSession(deps, again.sessionId, meta)).toBeNull();
  });

  it('changeOwnPassword verifies the current password, applies the policy, clears the flag and ends other sessions', async () => {
    const deps = createTestDeps();
    const userId = await userWithPassword(deps);
    deps.db.update(users).set({ mustChangePassword: true }).where(eq(users.id, userId)).run();
    const first = unwrap(await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta }));
    expect(first.mustChangePassword).toBe(true);
    const other = unwrap(await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta }));
    const ctx = resolveSession(deps, first.sessionId, meta)!.ctx;

    const wrong = await changeOwnPassword(deps, ctx, first.sessionId, { currentPassword: 'nope-nope-00-nope', newPassword: 'neues-langes-passwort' });
    expect(wrong.ok === false && wrong.error.type === 'unauthorized').toBe(true);
    const short = await changeOwnPassword(deps, ctx, first.sessionId, { currentPassword: PASSWORD, newPassword: 'kurz' });
    expect(short.ok === false && short.error.type === 'validation').toBe(true);

    expect((await changeOwnPassword(deps, ctx, first.sessionId, { currentPassword: PASSWORD, newPassword: 'neues-langes-passwort' })).ok).toBe(true);
    expect(resolveSession(deps, first.sessionId, meta)?.mustChangePassword).toBe(false);
    expect(resolveSession(deps, other.sessionId, meta)).toBeNull();
    expect(deps.db.select().from(sessions).all()).toHaveLength(1);
    expect((await login(deps, { email: 'anna@example.org', password: 'neues-langes-passwort', ...meta })).ok).toBe(true);
  });
});
