import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import { apiTokens } from '../db/schema';
import type { AppEnv, Deps } from '../deps';
import { newId } from '../ids';
import { notFound, ok, unauthorized, type Result } from '../result';
import { getEffectivePermissions } from '../roles/effective';
import { loadUserSummary } from '../users/service';
import { validate } from '../validate';
import type { RequestMeta } from './sessions';

export interface ApiTokenSummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function tokenPrefixFor(env: AppEnv): 'live' | 'test' | 'dev' {
  return env === 'production' ? 'live' : env === 'test' ? 'test' : 'dev';
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const toSummary = (row: typeof apiTokens.$inferSelect): ApiTokenSummary => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  createdAt: row.createdAt,
  lastUsedAt: row.lastUsedAt,
  revokedAt: row.revokedAt,
});

const createSchema = z.object({ name: z.string().trim().min(1).max(80) });

export async function createApiToken(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ token: string; record: ApiTokenSummary }>> {
  if (!ctx.userId) return unauthorized('invalidCredentials');
  const parsed = validate(deps, createSchema, input);
  if (!parsed.ok) return parsed;
  const token = `akx_${tokenPrefixFor(deps.env)}_${randomBytes(24).toString('base64url')}`;
  const userId = ctx.userId;
  return deps.db.transaction((tx) => {
    const id = newId();
    tx.insert(apiTokens)
      .values({ id, userId, name: parsed.value.name, prefix: token.slice(0, 12), tokenHash: hashToken(token), createdAt: isoNow(deps.clock) })
      .run();
    const record = toSummary(tx.select().from(apiTokens).where(eq(apiTokens.id, id)).get()!);
    recordAudit(tx, deps, ctx, { action: 'apiTokens.create', entityType: 'apiToken', entityId: id, after: record, summary: `API-Token „${record.name}" erstellt` });
    return ok({ token, record });
  });
}

export function resolveApiToken(deps: Deps, token: string, meta: RequestMeta): CallContext | null {
  const row = deps.db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashToken(token))).get();
  if (!row || row.revokedAt) return null;
  const user = loadUserSummary(deps.db, row.userId);
  if (!user || !user.isActive) return null;
  deps.db.update(apiTokens).set({ lastUsedAt: isoNow(deps.clock) }).where(eq(apiTokens.id, row.id)).run();
  return {
    userId: user.id,
    permissions: getEffectivePermissions(deps.db, deps.registry, user.id),
    channel: 'mcp',
    apiTokenId: row.id,
    ipAddress: meta.ipAddress,
    requestId: meta.requestId,
  };
}

const idSchema = z.object({ id: z.string().min(1) });

export async function revokeApiToken(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ApiTokenSummary>> {
  if (!ctx.userId) return unauthorized('invalidCredentials');
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(apiTokens).where(and(eq(apiTokens.id, parsed.value.id), eq(apiTokens.userId, ctx.userId))).get();
  if (!row) return notFound('apiToken', parsed.value.id);
  if (row.revokedAt) return ok(toSummary(row));
  return deps.db.transaction((tx) => {
    tx.update(apiTokens).set({ revokedAt: isoNow(deps.clock) }).where(eq(apiTokens.id, row.id)).run();
    const after = toSummary(tx.select().from(apiTokens).where(eq(apiTokens.id, row.id)).get()!);
    recordAudit(tx, deps, ctx, { action: 'apiTokens.revoke', entityType: 'apiToken', entityId: row.id, before: toSummary(row), after, summary: `API-Token „${row.name}" widerrufen` });
    return ok(after);
  });
}

export async function listApiTokens(deps: Deps, ctx: CallContext): Promise<Result<ApiTokenSummary[]>> {
  if (!ctx.userId) return unauthorized('invalidCredentials');
  const rows = deps.db.select().from(apiTokens).where(eq(apiTokens.userId, ctx.userId)).orderBy(apiTokens.createdAt).all();
  return ok(rows.map(toSummary));
}
