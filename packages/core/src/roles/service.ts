import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { rolePermissions, roles, userRoles, users } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import { requireAnyPermission, requirePermission } from '../permissions/check';
import { conflict, invalid, notFound, ok, type Result } from '../result';
import { validate } from '../validate';
import { countActiveProtectedHolders } from './effective';

export interface Role {
  id: string;
  name: string;
  description: string;
  isProtected: boolean;
  permissionKeys: string[];
  userCount: number;
}

function loadRole(db: DbOrTx, id: string): Role | null {
  const row = db.select().from(roles).where(eq(roles.id, id)).get();
  if (!row) return null;
  const keys = db
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, id))
    .all()
    .map((r) => r.key)
    .sort();
  const count = db
    .select({ count: sql<number>`count(*)` })
    .from(userRoles)
    .where(eq(userRoles.roleId, id))
    .get();
  return { id: row.id, name: row.name, description: row.description, isProtected: row.isProtected, permissionKeys: keys, userCount: count?.count ?? 0 };
}

const nameSchema = z.string().trim().min(1).max(80);
/** Geschützte Rollen entstehen nur im Setup (direktes Insert), nie über diese API. */
const createRoleSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(300).default(''),
});

function nameTaken(db: DbOrTx, name: string, exceptId?: string): boolean {
  const row = db
    .select({ id: roles.id })
    .from(roles)
    .where(sql`lower(${roles.name}) = lower(${name})`)
    .get();
  return !!row && row.id !== exceptId;
}

export async function createRole(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<Role>> {
  const denied = requirePermission(ctx, 'roles.manage');
  if (denied) return denied;
  const parsed = validate(deps, createRoleSchema, input);
  if (!parsed.ok) return parsed;
  const { name, description } = parsed.value;
  if (nameTaken(deps.db, name)) return conflict('roleNameTaken', `Rolle „${name}“ existiert bereits`);
  return deps.db.transaction((tx) => {
    const id = newId();
    tx.insert(roles).values({ id, name, description, isProtected: false, createdAt: isoNow(deps.clock) }).run();
    const role = loadRole(tx, id) as Role;
    recordAudit(tx, deps, ctx, { action: 'roles.create', entityType: 'role', entityId: id, after: role, summary: `Rolle „${name}“ angelegt` });
    return ok(role);
  });
}

const updateRoleSchema = z.object({ id: z.string().min(1), name: nameSchema.optional(), description: z.string().trim().max(300).optional() });

export async function updateRole(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<Role>> {
  const denied = requirePermission(ctx, 'roles.manage');
  if (denied) return denied;
  const parsed = validate(deps, updateRoleSchema, input);
  if (!parsed.ok) return parsed;
  const before = loadRole(deps.db, parsed.value.id);
  if (!before) return notFound('role', parsed.value.id);
  if (before.isProtected) return conflict('roleProtected', 'Geschützte Rolle kann nicht geändert werden');
  const name = parsed.value.name ?? before.name;
  if (nameTaken(deps.db, name, before.id)) return conflict('roleNameTaken', `Rolle „${name}“ existiert bereits`);
  return deps.db.transaction((tx) => {
    tx.update(roles).set({ name, description: parsed.value.description ?? before.description }).where(eq(roles.id, before.id)).run();
    const after = loadRole(tx, before.id) as Role;
    recordAudit(tx, deps, ctx, { action: 'roles.update', entityType: 'role', entityId: before.id, before, after, summary: `Rolle „${after.name}“ geändert` });
    return ok(after);
  });
}

const setPermissionsSchema = z.object({ roleId: z.string().min(1), permissionKeys: z.array(z.string()) });

export async function setRolePermissions(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<Role>> {
  const denied = requirePermission(ctx, 'roles.manage');
  if (denied) return denied;
  const parsed = validate(deps, setPermissionsSchema, input);
  if (!parsed.ok) return parsed;
  const unknown = parsed.value.permissionKeys
    .map((key, index) => ({ key, index }))
    .filter(({ key }) => !deps.registry.permissionKeys.has(key));
  if (unknown.length > 0) return invalid(unknown.map(({ index }) => ({ path: `permissionKeys.${index}`, message: 'unknownPermission' })));
  const before = loadRole(deps.db, parsed.value.roleId);
  if (!before) return notFound('role', parsed.value.roleId);
  if (before.isProtected) return conflict('roleProtected', 'Geschützte Rolle hat immer alle Rechte');
  const next = [...new Set(parsed.value.permissionKeys)].sort();
  return deps.db.transaction((tx) => {
    tx.delete(rolePermissions).where(eq(rolePermissions.roleId, before.id)).run();
    if (next.length > 0) tx.insert(rolePermissions).values(next.map((permissionKey) => ({ roleId: before.id, permissionKey }))).run();
    const after = loadRole(tx, before.id) as Role;
    recordAudit(tx, deps, ctx, { action: 'roles.setPermissions', entityType: 'role', entityId: before.id, before: before.permissionKeys, after: next, summary: `Rechte der Rolle „${before.name}“ geändert` });
    return ok(after);
  });
}

const assignmentSchema = z.object({ userId: z.string().min(1), roleId: z.string().min(1) });

export async function assignRole(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<void>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(deps, assignmentSchema, input);
  if (!parsed.ok) return parsed;
  const { userId, roleId } = parsed.value;
  const user = deps.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).get();
  if (!user) return notFound('user', userId);
  const role = loadRole(deps.db, roleId);
  if (!role) return notFound('role', roleId);
  return deps.db.transaction((tx) => {
    tx.insert(userRoles).values({ userId, roleId }).onConflictDoNothing().run();
    recordAudit(tx, deps, ctx, { action: 'users.assignRole', entityType: 'user', entityId: userId, after: { roleId, roleName: role.name }, summary: `Rolle „${role.name}“ an ${user.name} vergeben` });
    return ok(undefined);
  });
}

export async function removeRole(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<void>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(deps, assignmentSchema, input);
  if (!parsed.ok) return parsed;
  const { userId, roleId } = parsed.value;
  const user = deps.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).get();
  if (!user) return notFound('user', userId);
  const role = loadRole(deps.db, roleId);
  if (!role) return notFound('role', roleId);
  if (role.isProtected && countActiveProtectedHolders(deps.db, { excludeUserId: userId }) === 0) {
    return conflict('lastAdministrator', 'Mindestens ein aktiver Nutzer muss die geschützte Rolle behalten');
  }
  return deps.db.transaction((tx) => {
    tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId))).run();
    recordAudit(tx, deps, ctx, { action: 'users.removeRole', entityType: 'user', entityId: userId, before: { roleId, roleName: role.name }, summary: `Rolle „${role.name}“ von ${user.name} entfernt` });
    return ok(undefined);
  });
}

export async function listRoles(deps: Deps, ctx: CallContext): Promise<Result<Role[]>> {
  const denied = requireAnyPermission(ctx, ['roles.manage', 'users.manage']);
  if (denied) return denied;
  const ids = deps.db.select({ id: roles.id }).from(roles).orderBy(roles.name).all();
  return ok(ids.map(({ id }) => loadRole(deps.db, id) as Role));
}
