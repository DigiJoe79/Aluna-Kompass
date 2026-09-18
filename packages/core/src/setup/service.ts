import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { hashPassword, passwordSchema } from '../auth/password';
import { createSession } from '../auth/sessions';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import { roles, userRoles, users } from '../db/schema';
import type { Deps } from '../deps';
import { LOCALE_CODE } from '../i18n/locales';
import { newId } from '../ids';
import { conflict, ok, type Result } from '../result';
import { writeSettingInternal } from '../settings/service';
import { normalizeEmail } from '../users/service';
import { validate } from '../validate';

export const PROTECTED_ROLE_NAME = 'Administration';

export function isSetupRequired(deps: Deps): boolean {
  const row = deps.db.select({ count: sql<number>`count(*)` }).from(users).get();
  return (row?.count ?? 0) === 0;
}

const setupSchema = z.object({
  organizationName: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  email: z.email().transform(normalizeEmail),
  password: passwordSchema,
  locale: z.string().regex(LOCALE_CODE).default('de'),
  requestId: z.string().min(1),
  ipAddress: z.string().nullable(),
});

export async function completeSetup(deps: Deps, input: unknown): Promise<Result<{ userId: string; sessionId: string; expiresAt: string }>> {
  if (!isSetupRequired(deps)) return conflict('setupAlreadyDone', 'Die Einrichtung wurde bereits abgeschlossen');
  const parsed = validate(deps, setupSchema, input);
  if (!parsed.ok) return parsed;
  const { organizationName, name, email, password, locale, requestId, ipAddress } = parsed.value;
  const passwordHash = await hashPassword(password);
  return deps.db.transaction((tx) => {
    const now = isoNow(deps.clock);
    const userId = newId();
    const roleId = newId();
    tx.insert(users).values({ id: userId, name, email, passwordHash, mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now }).run();
    tx.insert(roles).values({ id: roleId, name: PROTECTED_ROLE_NAME, description: 'Alle Rechte. Wird beim Setup angelegt und ist geschützt.', isProtected: true, createdAt: now }).run();
    tx.insert(userRoles).values({ userId, roleId }).run();
    const ctx: CallContext = { userId, permissions: new Set(deps.registry.permissionKeys), channel: 'ui', apiTokenId: null, ipAddress, requestId };
    const org = writeSettingInternal(tx, deps, ctx, 'organization.name', organizationName, 'setup.organizationName');
    if (!org.ok) return org;
    const localesRes = writeSettingInternal(tx, deps, ctx, 'i18n.locales', [locale], 'setup.locales');
    if (!localesRes.ok) return localesRes;
    const session = createSession(tx, deps, userId);
    tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, userId)).run();
    recordAudit(tx, deps, ctx, { action: 'setup.complete', entityType: 'user', entityId: userId, after: { name, email, role: PROTECTED_ROLE_NAME }, summary: `Einrichtung abgeschlossen durch ${name}` });
    return ok({ userId, sessionId: session.id, expiresAt: session.expiresAt });
  });
}
