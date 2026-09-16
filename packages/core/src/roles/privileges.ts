import { eq } from 'drizzle-orm';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { rolePermissions, roles } from '../db/schema';
import type { Deps } from '../deps';
import { conflict, type Failure } from '../result';
import { getEffectivePermissions } from './effective';

/**
 * Niemand vergibt Rechte, die er selbst nicht hat — und niemand verfügt über
 * ein Konto, das mehr Rechte hat als er selbst. Maßstab sind die Rechte dieses
 * Aufrufs, nicht die des Nutzers: Ein eingeschränktes Token reicht nicht weiter
 * als seine Rechte. Schlüssel, die kein Modul mehr kennt, zählen nicht.
 */

function missingFrom(ctx: CallContext, keys: Iterable<string>): string[] {
  return [...keys].filter((key) => !ctx.permissions.has(key));
}

function insufficientPrivileges(missing: string[]): Failure {
  return conflict('insufficientPrivileges', `Dafür fehlen eigene Rechte: ${missing.join(', ')}`);
}

function roleGrants(db: DbOrTx, deps: Deps, roleId: string): string[] {
  const role = db.select({ isProtected: roles.isProtected }).from(roles).where(eq(roles.id, roleId)).get();
  if (!role) return [];
  if (role.isProtected) return [...deps.registry.permissionKeys];
  return db
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId))
    .all()
    .map((r) => r.key)
    .filter((key) => deps.registry.permissionKeys.has(key));
}

/** Darf der Aufrufer diese Rolle vergeben? */
export function requireGrantableRole(deps: Deps, ctx: CallContext, roleId: string): Failure | null {
  const missing = missingFrom(ctx, roleGrants(deps.db, deps, roleId));
  return missing.length > 0 ? insufficientPrivileges(missing) : null;
}

/** Darf der Aufrufer diese Rechte einer Rolle hinzufügen? */
export function requireGrantablePermissions(deps: Deps, ctx: CallContext, keys: Iterable<string>): Failure | null {
  const missing = missingFrom(ctx, [...keys].filter((key) => deps.registry.permissionKeys.has(key)));
  return missing.length > 0 ? insufficientPrivileges(missing) : null;
}

/** Darf der Aufrufer über dieses Konto verfügen? */
export function requireControllableUser(deps: Deps, ctx: CallContext, userId: string): Failure | null {
  const missing = missingFrom(ctx, getEffectivePermissions(deps.db, deps.registry, userId));
  return missing.length > 0 ? insufficientPrivileges(missing) : null;
}
