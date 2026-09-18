import { and, count, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import { systemContext, type CallContext } from '../context';
import { auditLog, users } from '../db/schema';
import type { DbOrTx } from '../db/client';
import type { Deps } from '../deps';
import { ok, unauthorized, type Result } from '../result';
import { normalizeEmail } from '../users/service';
import { validate } from '../validate';
import { hashPassword, passwordSchema, verifyPassword } from './password';
import { createSession, revokeUserSessions, type RequestMeta } from './sessions';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
/**
 * Fehlversuche über alle Konten im selben Zeitfenster, nach denen die Anmeldung
 * für alle pausiert. Die Sperre je Konto hält Raten gegen ein Konto auf, nicht
 * wenige Versuche gegen viele. Global statt je Absender, weil die Adresse aus
 * einem Header kommt, den ohne Proxy jeder selbst setzt.
 */
export const MAX_FAILED_LOGINS_TOTAL = 20;

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

function recentFailures(db: DbOrTx, since: string): number {
  const row = db
    .select({ n: count() })
    .from(auditLog)
    .where(and(eq(auditLog.action, 'auth.failed'), gt(auditLog.occurredAt, since)))
    .get();
  return row?.n ?? 0;
}

/**
 * Jede Antwort auf ein falsches Passwort ist dieselbe, ob das Konto existiert,
 * gesperrt oder deaktiviert ist. Sperre und Deaktivierung erfährt nur, wer das
 * richtige Passwort kennt.
 */
export async function login(deps: Deps, input: unknown): Promise<Result<LoginResult>> {
  const parsed = validate(deps, loginSchema, input);
  if (!parsed.ok) return unauthorized('invalidCredentials');
  const { email, password, ipAddress, requestId } = parsed.value;
  const now = isoNow(deps.clock);
  const windowStart = new Date(deps.clock.now().getTime() - LOCK_MINUTES * 60_000).toISOString();
  if (recentFailures(deps.db, windowStart) >= MAX_FAILED_LOGINS_TOTAL) return unauthorized('throttled');

  const system: CallContext = { ...systemContext(requestId), ipAddress };
  const user = deps.db.select().from(users).where(eq(users.email, email)).get();
  const valid = user
    ? await verifyPassword(user.passwordHash, password)
    : await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', password); // gleiche Antwortzeit

  if (!user || !valid) {
    const isLocked = !!user?.lockedUntil && user.lockedUntil > now;
    const failed = user && !isLocked ? user.failedLoginCount + 1 : 0;
    deps.db.transaction((tx) => {
      recordAudit(tx, deps, system, {
        action: 'auth.failed',
        entityType: 'user',
        entityId: user?.id ?? null,
        summary: `Anmeldung als ${email} fehlgeschlagen`,
      });
      if (user && !isLocked) {
        if (failed >= MAX_FAILED_LOGINS) {
          const lockedUntil = new Date(deps.clock.now().getTime() + LOCK_MINUTES * 60_000).toISOString();
          tx.update(users).set({ failedLoginCount: 0, lockedUntil, updatedAt: now }).where(eq(users.id, user.id)).run();
          recordAudit(tx, deps, system, {
            action: 'auth.locked',
            entityType: 'user',
            entityId: user.id,
            after: { lockedUntil },
            summary: `Konto ${user.email} nach ${MAX_FAILED_LOGINS} Fehlversuchen gesperrt`,
          });
        } else {
          tx.update(users).set({ failedLoginCount: failed, updatedAt: now }).where(eq(users.id, user.id)).run();
        }
      }
      if (recentFailures(tx, windowStart) === MAX_FAILED_LOGINS_TOTAL) {
        recordAudit(tx, deps, system, {
          action: 'auth.throttled',
          entityType: 'auth',
          entityId: null,
          summary: `Anmeldung nach ${MAX_FAILED_LOGINS_TOTAL} Fehlversuchen in ${LOCK_MINUTES} Minuten für alle pausiert`,
        });
      }
    });
    return unauthorized('invalidCredentials');
  }

  if (user.lockedUntil && user.lockedUntil > now) return unauthorized('locked', { lockedUntil: user.lockedUntil });
  if (!user.isActive) return unauthorized('inactive');

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
