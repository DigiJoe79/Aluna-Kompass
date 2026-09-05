import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createApiToken, listApiTokens, resolveApiToken, revokeApiToken, tokenPrefixFor } from '../src/auth/tokens';
import { apiTokens, auditLog, users } from '../src/db/schema';
import { assignRole, createRole, setRolePermissions } from '../src/roles/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const meta = { ipAddress: '10.0.0.7', requestId: 'REQ-MCP' };

describe('api tokens', () => {
  it('creates a token shown once, stores only a hash, and resolves to an mcp context with the owner permissions', async () => {
    const deps = createTestDeps();
    const userId = insertUser(deps, {});
    const admin = ctxWith(['roles.manage', 'users.manage']);
    const role = unwrap(await createRole(deps, admin, { name: 'Prüfer' }));
    unwrap(await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: ['audit.view'] }));
    unwrap(await assignRole(deps, admin, { userId, roleId: role.id }));

    const { token, record } = unwrap(await createApiToken(deps, ctxWith([], userId), { name: 'Buchhaltung Skript' }));
    expect(token).toMatch(/^akx_test_[A-Za-z0-9_-]{32,}$/);
    expect(record.prefix).toBe(token.slice(0, 12));
    const stored = deps.db.select().from(apiTokens).all()[0]!;
    expect(stored.tokenHash).not.toContain(token.slice(9));
    expect(deps.db.select().from(auditLog).all().at(-1)?.after).not.toContain(token);

    const ctx = resolveApiToken(deps, token, meta);
    expect(ctx).toMatchObject({ userId, channel: 'mcp', apiTokenId: record.id, ipAddress: '10.0.0.7', requestId: 'REQ-MCP' });
    expect([...ctx!.permissions]).toEqual(['audit.view']);
    expect(deps.db.select().from(apiTokens).all()[0]?.lastUsedAt).toBe('2026-09-05T08:00:00.000Z');
  });

  it('uses live/test/dev prefixes by environment', () => {
    expect(tokenPrefixFor('production')).toBe('live');
    expect(tokenPrefixFor('test')).toBe('test');
    expect(tokenPrefixFor('development')).toBe('dev');
  });

  it('rejects unknown, revoked and inactive-user tokens', async () => {
    const deps = createTestDeps();
    const userId = insertUser(deps, {});
    const ctx = ctxWith([], userId);
    const { token, record } = unwrap(await createApiToken(deps, ctx, { name: 'A' }));
    expect(resolveApiToken(deps, 'akx_test_nope', meta)).toBeNull();
    unwrap(await revokeApiToken(deps, ctx, { id: record.id }));
    expect(resolveApiToken(deps, token, meta)).toBeNull();
    const { token: second } = unwrap(await createApiToken(deps, ctx, { name: 'B' }));
    deps.db.update(users).set({ isActive: false }).where(eq(users.id, userId)).run();
    expect(resolveApiToken(deps, second, meta)).toBeNull();
  });

  it('lists own tokens including revoked ones and refuses to revoke someone else\'s token', async () => {
    const deps = createTestDeps();
    const a = insertUser(deps, { email: 'a@example.org' });
    const b = insertUser(deps, { email: 'b@example.org' });
    const { record } = unwrap(await createApiToken(deps, ctxWith([], a), { name: 'A1' }));
    unwrap(await createApiToken(deps, ctxWith([], b), { name: 'B1' }));
    unwrap(await revokeApiToken(deps, ctxWith([], a), { id: record.id }));
    const list = unwrap(await listApiTokens(deps, ctxWith([], a)));
    expect(list.map((t) => [t.name, t.revokedAt !== null])).toEqual([['A1', true]]);
    const foreign = await revokeApiToken(deps, ctxWith([], b), { id: record.id });
    expect(foreign.ok === false && foreign.error.type === 'notFound').toBe(true);
    const anon = await createApiToken(deps, ctxWith([], null), { name: 'X' });
    expect(anon.ok === false && anon.error.type === 'unauthorized').toBe(true);
  });
});
