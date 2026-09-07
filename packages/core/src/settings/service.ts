import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { settings } from '../db/schema';
import type { Deps } from '../deps';
import type { SettingDefinition } from '../modules/manifest';
import { requirePermission } from '../permissions/check';
import { conflict, invalid, ok, type Result } from '../result';
import { validate } from '../validate';

function definitionOf(deps: Deps, key: string): SettingDefinition {
  const def = deps.registry.settingDefinitions.get(key);
  if (!def) throw new Error(`unknown setting: ${key}`);
  return def;
}

function readStored(db: DbOrTx, key: string): { found: true; value: unknown } | { found: false } {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
  return row ? { found: true, value: JSON.parse(row.value) } : { found: false };
}

export function readSetting<T = unknown>(deps: Deps, key: string): T {
  const def = definitionOf(deps, key);
  const stored = readStored(deps.db, key);
  return (stored.found ? stored.value : def.default) as T;
}

export function readAllSettings(deps: Deps): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of deps.registry.settingDefinitions.keys()) out[key] = readSetting(deps, key);
  return out;
}

/**
 * Schreibt ohne Rechteprüfung (für Setup, Import, Theme-Service), aber immer validiert
 * und protokolliert. Muss innerhalb einer Transaktion des Aufrufers laufen.
 */
export function writeSettingInternal(
  tx: DbOrTx,
  deps: Deps,
  ctx: CallContext,
  key: string,
  value: unknown,
  action: string = 'settings.update',
): Result<{ key: string; value: unknown }> {
  const def = definitionOf(deps, key);
  const parsed = validate(deps, def.schema, value);
  if (!parsed.ok) return parsed;
  const previous = readStored(tx, key);
  const before = previous.found ? previous.value : def.default;
  tx.insert(settings)
    .values({ key, value: JSON.stringify(parsed.value), updatedAt: isoNow(deps.clock), updatedByUserId: ctx.userId })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(parsed.value), updatedAt: isoNow(deps.clock), updatedByUserId: ctx.userId },
    })
    .run();
  recordAudit(tx, deps, ctx, {
    action,
    entityType: 'setting',
    entityId: key,
    before,
    after: parsed.value,
    summary: `${key} geändert`,
  });
  return ok({ key, value: parsed.value });
}

const setSettingSchema = z.object({ key: z.string().min(1), value: z.unknown() });

export async function setSetting(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<{ key: string; value: unknown }>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, setSettingSchema, input);
  if (!parsed.ok) return parsed;
  const def = deps.registry.settingDefinitions.get(parsed.value.key);
  if (!def) return invalid([{ path: 'key', message: 'unknownSetting' }]);
  if (def.systemOnly) return conflict('settingSystemOnly', `${def.key} wird nur vom System gesetzt`);
  return deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctx, def.key, parsed.value.value));
}
