import { and, eq, ne, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { rolePermissions, roles, userRoles, users } from '../db/schema';
import type { Registry } from '../modules/registry';

export function getEffectivePermissions(db: DbOrTx, registry: Registry, userId: string): Set<string> {
  const held = db
    .select({ roleId: roles.id, isProtected: roles.isProtected })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))
    .all();
  if (held.some((r) => r.isProtected)) return new Set(registry.permissionKeys);
  const result = new Set<string>();
  for (const { roleId } of held) {
    const keys = db
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId))
      .all();
    for (const { key } of keys) if (registry.permissionKeys.has(key)) result.add(key);
  }
  return result;
}

export function countActiveProtectedHolders(db: DbOrTx, opts: { excludeUserId?: string } = {}): number {
  const conditions = [eq(roles.isProtected, true), eq(users.isActive, true)];
  if (opts.excludeUserId) conditions.push(ne(users.id, opts.excludeUserId));
  const row = db
    .select({ count: sql<number>`count(distinct ${users.id})` })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(...conditions))
    .get();
  return row?.count ?? 0;
}
