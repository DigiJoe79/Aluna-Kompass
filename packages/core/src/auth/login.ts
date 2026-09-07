import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import { systemContext, type CallContext } from '../context';
import { users } from '../db/schema';
import type { Deps } from '../deps';
import { ok, unauthorized, type Result } from '../result';
import { normalizeEmail } from '../users/service';
import { validate } from '../validate';
import { hashPassword, passwordSchema, verifyPassword } from './password';
import { createSession, revokeUserSessions, type RequestMeta } from './sessions';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

const loginSchema = z.object({
  email: z.string().trim().min(1).transform(normalizeEmail),
  password: z.string().min(1),
  ipAddress: z.string().nullable(),
  requestId: z.string().min(1),
});

export interface LoginResult {
  sessionId: string;
  expiresAt: string;
  userId: string;
  mustChangePassword: boolean;
}

export async function login(deps: Deps, input: unknown): Promise<Result<LoginResult>> {
  const parsed = validate(deps, loginSchema, input);
  if (!parsed.ok) return unauthorized('invalidCredentials');
  const { email, password, ipAddress, requestId } = parsed.value;
  const user = deps.db.select().from(users).where(eq(users.email, email)).get();
  if (!user) {
    await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', password); // gleiche Antwortzeit
    return unauthorized('invalidCredentials');
  }
  const now = isoNow(deps.clock);
  if (user.lockedUntil && user.lockedUntil > now) return unauthorized('locked', { lockedUntil: user.lockedUntil });
  if (!user.isActive) return unauthorized('inactive');

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    if (failed >= MAX_FAILED_LOGINS) {
      const lockedUntil = new Date(deps.clock.now().getTime() + LOCK_MINUTES * 60_000).toISOString();
      deps.db.transaction((tx) => {
        tx.update(users).set({ failedLoginCount: 0, lockedUntil, updatedAt: now }).where(eq(users.id, user.id)).run();
        recordAudit(tx, deps, { ...systemContext(requestId), ipAddress }, {
          action: 'auth.locked',
          entityType: 'user',
          entityId: user.id,
          after: { lockedUntil },
          summary: `Konto ${user.email} nach ${MAX_FAILED_LOGINS} Fehlversuchen gesperrt`,
        });
      });
      return unauthorized('locked', { lockedUntil });
    }
    deps.db.update(users).set({ failedLoginCount: failed, updatedAt: now }).where(eq(users.id, user.id)).run();
    return unauthorized('invalidCredentials', { attemptsLeft: MAX_FAILED_LOGINS - failed });
  }

  return deps.db.transaction((tx) => {
    tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now }).where(eq(users.id, user.id)).run();
    const session = createSession(tx, deps, user.id);
    const ctx: CallContext = { userId: user.id, permissions: new Set(), channel: 'ui', apiTokenId: null, ipAddress, requestId };
    recordAudit(tx, deps, ctx, { action: 'auth.login', entityType: 'user', entityId: user.id, summary: `${user.email} angemeldet` });
    return ok({ sessionId: session.id, expiresAt: session.expiresAt, userId: user.id, mustChangePassword: user.mustChangePassword });
  });
}

const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

export async function changeOwnPassword(deps: Deps, ctx: CallContext, sessionId: string, input: unknown): Promise<Result<void>> {
  if (!ctx.userId) return unauthorized('invalidCredentials');
  const parsed = validate(deps, changePasswordSchema, input);
  if (!parsed.ok) return parsed;
  const user = deps.db.select().from(users).where(eq(users.id, ctx.userId)).get();
  if (!user) return unauthorized('invalidCredentials');
  if (!(await verifyPassword(user.passwordHash, parsed.value.currentPassword))) return unauthorized('invalidCredentials');
  const passwordHash = await hashPassword(parsed.value.newPassword);
  return deps.db.transaction((tx) => {
    tx.update(users).set({ passwordHash, mustChangePassword: false, updatedAt: isoNow(deps.clock) }).where(eq(users.id, user.id)).run();
    revokeUserSessions(tx, user.id, sessionId);
    recordAudit(tx, deps, ctx, { action: 'auth.changePassword', entityType: 'user', entityId: user.id, summary: `${user.email} hat das Passwort geändert` });
    return ok(undefined);
  });
}
