import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { generateStartPassword, hashPassword } from '../auth/password';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { roles, sessions, userRoles, users } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import { requirePermission } from '../permissions/check';
import { conflict, notFound, ok, type Result } from '../result';
import { countActiveProtectedHolders } from '../roles/effective';
import { validate } from '../validate';

export type UserStatus = 'active' | 'firstLoginPending' | 'inactive';

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  mustChangePassword: boolean;
  status: UserStatus;
  lastLoginAt: string | null;
  roles: { id: string; name: string }[];
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export function loadUserSummary(db: DbOrTx, id: string): UserSummary | null {
  const row = db.select().from(users).where(eq(users.id, id)).get();
  if (!row) return null;
  const held = db
    .select({ id: roles.id, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, id))
    .orderBy(roles.name)
    .all();
  const status: UserStatus = !row.isActive ? 'inactive' : row.mustChangePassword && !row.lastLoginAt ? 'firstLoginPending' : 'active';
  return { id: row.id, name: row.name, email: row.email, isActive: row.isActive, mustChangePassword: row.mustChangePassword, status, lastLoginAt: row.lastLoginAt, roles: held };
}

function emailTaken(db: DbOrTx, email: string, exceptId?: string): boolean {
  const row = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  return !!row && row.id !== exceptId;
}

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().transform(normalizeEmail),
  roleIds: z.array(z.string().min(1)).default([]),
});

export async function createUser(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ user: UserSummary; startPassword: string }>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(createUserSchema, input);
  if (!parsed.ok) return parsed;
  const { name, email, roleIds } = parsed.value;
  if (emailTaken(deps.db, email)) return conflict('emailTaken', `E-Mail ${email} ist bereits vergeben`);
  for (const roleId of roleIds) {
    if (!deps.db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).get()) return notFound('role', roleId);
  }
  const startPassword = generateStartPassword();
  const passwordHash = await hashPassword(startPassword);
  return deps.db.transaction((tx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(users).values({ id, name, email, passwordHash, mustChangePassword: true, isActive: true, createdAt: now, updatedAt: now }).run();
    if (roleIds.length > 0) tx.insert(userRoles).values(roleIds.map((roleId) => ({ userId: id, roleId }))).run();
    const user = loadUserSummary(tx, id) as UserSummary;
    recordAudit(tx, deps, ctx, { action: 'users.create', entityType: 'user', entityId: id, after: user, summary: `Nutzer ${name} angelegt` });
    return ok({ user, startPassword });
  });
}

export async function listUsers(deps: Deps, ctx: CallContext): Promise<Result<UserSummary[]>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const ids = deps.db.select({ id: users.id }).from(users).orderBy(sql`lower(${users.name})`).all();
  return ok(ids.map(({ id }) => loadUserSummary(deps.db, id) as UserSummary));
}

export async function getUser(deps: Deps, ctx: CallContext, id: string): Promise<Result<UserSummary>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const user = loadUserSummary(deps.db, id);
  return user ? ok(user) : notFound('user', id);
}

const updateUserSchema = z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(120), email: z.email().transform(normalizeEmail) });

export async function updateUser(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<UserSummary>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(updateUserSchema, input);
  if (!parsed.ok) return parsed;
  const { id, name, email } = parsed.value;
  const before = loadUserSummary(deps.db, id);
  if (!before) return notFound('user', id);
  if (emailTaken(deps.db, email, id)) return conflict('emailTaken', `E-Mail ${email} ist bereits vergeben`);
  return deps.db.transaction((tx) => {
    tx.update(users).set({ name, email, updatedAt: isoNow(deps.clock) }).where(eq(users.id, id)).run();
    const after = loadUserSummary(tx, id) as UserSummary;
    recordAudit(tx, deps, ctx, { action: 'users.update', entityType: 'user', entityId: id, before, after, summary: `Nutzer ${after.name} geändert` });
    return ok(after);
  });
}

const setActiveSchema = z.object({ id: z.string().min(1), isActive: z.boolean() });

export async function setUserActive(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<UserSummary>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(setActiveSchema, input);
  if (!parsed.ok) return parsed;
  const { id, isActive } = parsed.value;
  const before = loadUserSummary(deps.db, id);
  if (!before) return notFound('user', id);
  if (!isActive && before.isActive && countActiveProtectedHolders(deps.db, { excludeUserId: id }) === 0 && countActiveProtectedHolders(deps.db) > 0) {
    return conflict('lastAdministrator', 'Der letzte aktive Administrator kann nicht deaktiviert werden');
  }
  return deps.db.transaction((tx) => {
    tx.update(users).set({ isActive, updatedAt: isoNow(deps.clock) }).where(eq(users.id, id)).run();
    if (!isActive) tx.delete(sessions).where(eq(sessions.userId, id)).run();
    const after = loadUserSummary(tx, id) as UserSummary;
    recordAudit(tx, deps, ctx, { action: isActive ? 'users.activate' : 'users.deactivate', entityType: 'user', entityId: id, before, after, summary: `Nutzer ${after.name} ${isActive ? 'aktiviert' : 'deaktiviert'}` });
    return ok(after);
  });
}

const idSchema = z.object({ id: z.string().min(1) });

export async function resetStartPassword(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ startPassword: string }>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(idSchema, input);
  if (!parsed.ok) return parsed;
  const user = loadUserSummary(deps.db, parsed.value.id);
  if (!user) return notFound('user', parsed.value.id);
  const startPassword = generateStartPassword();
  const passwordHash = await hashPassword(startPassword);
  return deps.db.transaction((tx) => {
    tx.update(users).set({ passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, updatedAt: isoNow(deps.clock) }).where(eq(users.id, user.id)).run();
    tx.delete(sessions).where(eq(sessions.userId, user.id)).run();
    recordAudit(tx, deps, ctx, { action: 'users.resetStartPassword', entityType: 'user', entityId: user.id, summary: `Startpasswort für ${user.name} neu gesetzt` });
    return ok({ startPassword });
  });
}
