import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { changeOwnPassword, LOCK_MINUTES, login, MAX_FAILED_LOGINS, MAX_FAILED_LOGINS_TOTAL } from '../src/auth/login';
import { hashPassword } from '../src/auth/password';
import { resolveSession, revokeSession } from '../src/auth/sessions';
import { auditLog, sessions, users } from '../src/db/schema';
import { CORE_PERMISSIONS } from '../src/permissions/core';
import { assignRole, createRole, setRolePermissions } from '../src/roles/service';
import { unwrap } from '../src/result';
import { auditEntry, createTestDeps, ctxWith, insertUser } from '../src/testing';

const meta = { ipAddress: '10.0.0.5', requestId: 'REQ-1' };
const PASSWORD = 'wiese-kanu-73-lampe';

async function userWithPassword(deps: ReturnType<typeof createTestDeps>, overrides: Parameters<typeof insertUser>[1] = {}) {
  return insertUser(deps, { email: 'anna@example.org', passwordHash: await hashPassword(PASSWORD), ...overrides });
}

describe('login and sessions', () => {
  it('logs in with correct credentials, creates a session and resolves it to a context with effective permissions', async () => {
    const deps = createTestDeps();
    const userId = await userWithPassword(deps);
    const admin = ctxWith(CORE_PERMISSIONS);
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

  const wrong = (email = 'anna@example.org') => ({ email, password: 'falsch-falsch-00-falsch', ...meta });
  const isReason = (r: Awaited<ReturnType<typeof login>>, reason: string) =>
    r.ok === false && r.error.type === 'unauthorized' && r.error.reason === reason && !('attemptsLeft' in r.error);

  it('answers every wrong password the same way and locks after five failures with a system audit entry', async () => {
    const deps = createTestDeps();
    const userId = await userWithPassword(deps);
    for (let attempt = 1; attempt <= MAX_FAILED_LOGINS; attempt += 1) {
      expect(isReason(await login(deps, wrong()), 'invalidCredentials')).toBe(true);
    }
    const locked = deps.db.select().from(auditLog).all().find((e) => e.action === 'auth.locked');
    expect(locked).toMatchObject({ channel: 'system', userId: null, entityType: 'user', entityId: userId });

    // Die Sperre erfährt nur, wer das Passwort kennt — ein Rater sieht dieselbe Antwort wie bei einem fremden Konto.
    expect(isReason(await login(deps, wrong()), 'invalidCredentials')).toBe(true);
    expect(isReason(await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta }), 'locked')).toBe(true);

    deps.clock.advance((LOCK_MINUTES + 1) * 60_000);
    expect((await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta })).ok).toBe(true);
  });

  it('does not reveal whether an email exists or an account is inactive', async () => {
    const deps = createTestDeps();
    expect(isReason(await login(deps, { email: 'nobody@example.org', password: PASSWORD, ...meta }), 'invalidCredentials')).toBe(true);
    await userWithPassword(deps, { isActive: false });
    expect(isReason(await login(deps, wrong()), 'invalidCredentials')).toBe(true);
    expect(isReason(await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta }), 'inactive')).toBe(true);
  });

  it('records every failed login with the address it came from, known account or not', async () => {
    const deps = createTestDeps();
    const userId = await userWithPassword(deps);
    await login(deps, wrong());
    await login(deps, wrong('nobody@example.org'));
    const failed = deps.db.select().from(auditLog).all().filter((e) => e.action === 'auth.failed');
    expect(failed).toEqual([
      expect.objectContaining({ channel: 'system', userId: null, entityType: 'user', entityId: userId, ipAddress: '10.0.0.5' }),
      expect.objectContaining({ channel: 'system', userId: null, entityType: 'user', entityId: null, ipAddress: '10.0.0.5' }),
    ]);
    expect(failed[1]!.summary).toContain('nobody@example.org');
  });

  it('pauses all logins after too many failures across accounts, and resumes when the window has passed', async () => {
    const deps = createTestDeps();
    await userWithPassword(deps);
    // Passwort-Spraying: je Konto unter der Sperrgrenze, zusammen darüber.
    for (let i = 0; i < MAX_FAILED_LOGINS_TOTAL; i += 1) await login(deps, wrong(`person${i % 10}@example.org`));
    const paused = await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta });
    expect(isReason(paused, 'throttled')).toBe(true);
    expect(deps.db.select().from(auditLog).all().filter((e) => e.action === 'auth.throttled')).toHaveLength(1);
    // Abgewiesene Versuche zählen nicht weiter, sonst hörte die Pause nie auf.
    expect(deps.db.select().from(auditLog).all().filter((e) => e.action === 'auth.failed')).toHaveLength(MAX_FAILED_LOGINS_TOTAL);

    deps.clock.advance((LOCK_MINUTES + 1) * 60_000);
    expect((await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta })).ok).toBe(true);
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
    const changed = auditEntry(deps, 'auth.changePassword');
    expect(changed).toMatchObject({ entityType: 'user', entityId: userId });
    // Weder das alte noch das neue Passwort darf im Protokoll landen.
    expect(JSON.stringify(changed)).not.toContain('neues-langes-passwort');
    expect(JSON.stringify(changed)).not.toContain(PASSWORD);
    expect(resolveSession(deps, first.sessionId, meta)?.mustChangePassword).toBe(false);
    expect(resolveSession(deps, other.sessionId, meta)).toBeNull();
    expect(deps.db.select().from(sessions).all()).toHaveLength(1);
    expect((await login(deps, { email: 'anna@example.org', password: 'neues-langes-passwort', ...meta })).ok).toBe(true);
  });
});
