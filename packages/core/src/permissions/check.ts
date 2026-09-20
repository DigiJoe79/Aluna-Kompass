import type { CallContext } from '../context';
import { forbidden, type Failure } from '../result';

export function hasPermission(ctx: CallContext, key: string): boolean {
  return ctx.permissions.has(key);
}

export function requirePermission(ctx: CallContext, key: string): Failure | null {
  return hasPermission(ctx, key) ? null : forbidden(key);
}

/** Erlaubt, wenn mindestens einer der Keys vorhanden ist; meldet sonst den ersten Key. */
export function requireAnyPermission(ctx: CallContext, keys: readonly string[]): Failure | null {
  if (keys.some((key) => hasPermission(ctx, key))) return null;
  return forbidden(keys[0] ?? '');
}

export type PermissionSpec = string | readonly string[];

/** Ohne Angabe: erlaubt. Mit Liste: eines genügt; eine leere Liste erlaubt niemandem etwas. */
export function hasAnyOf(permissions: ReadonlySet<string>, spec?: PermissionSpec): boolean {
  if (spec === undefined) return true;
  return typeof spec === 'string' ? permissions.has(spec) : spec.some((key) => permissions.has(key));
}
