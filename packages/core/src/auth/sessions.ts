import { randomBytes } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { sessions } from '../db/schema';
import type { Deps } from '../deps';
import { getEffectivePermissions } from '../roles/effective';
import { loadUserSummary, type UserSummary } from '../users/service';

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface RequestMeta {
  ipAddress: string | null;
  requestId: string;
}

export function createSession(tx: DbOrTx, deps: Pick<Deps, 'clock'>, userId: string): { id: string; expiresAt: string } {
  const id = randomBytes(32).toString('base64url');
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  tx.insert(sessions).values({ id, userId, createdAt: now.toISOString(), expiresAt }).run();
  return { id, expiresAt };
}

export interface ResolvedSession {
  ctx: CallContext;
  user: UserSummary;
  mustChangePassword: boolean;
}

export function resolveSession(deps: Deps, sessionId: string, meta: RequestMeta): ResolvedSession | null {
  const row = deps.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!row) return null;
  if (row.expiresAt <= isoNow(deps.clock)) {
    deps.db.delete(sessions).where(eq(sessions.id, sessionId)).run();
    return null;
  }
  const user = loadUserSummary(deps.db, row.userId);
  if (!user || !user.isActive) return null;
  return {
    user,
    mustChangePassword: user.mustChangePassword,
    ctx: {
      userId: user.id,
      permissions: getEffectivePermissions(deps.db, deps.registry, user.id),
      channel: 'ui',
      apiTokenId: null,
      ipAddress: meta.ipAddress,
      requestId: meta.requestId,
    },
  };
}

export function revokeSession(deps: Pick<Deps, 'db'>, sessionId: string): void {
  deps.db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

export function revokeUserSessions(tx: DbOrTx, userId: string, exceptSessionId?: string): void {
  const where = exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)) : eq(sessions.userId, userId);
  tx.delete(sessions).where(where).run();
}
