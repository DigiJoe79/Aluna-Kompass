import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import { LOCALIZED_COLUMNS } from '../db/columns';
import { settings } from '../db/schema';
import type { Deps } from '../deps';
import { requirePermission } from '../permissions/check';
import { conflict, invalid, ok, type Result } from '../result';
import { validate } from '../validate';
import { LOCALE_CODE, readLocales } from './locales';

const codeSchema = z.object({ code: z.string().regex(LOCALE_CODE) });
const removeSchema = z.object({ code: z.string().regex(LOCALE_CODE), confirm: z.boolean() });
const orderSchema = z.object({ codes: z.array(z.string().regex(LOCALE_CODE)).min(1) });

export interface LocaleRemovalPreview {
  code: string;
  filled: number;
  tables: { table: string; column: string; filled: number }[];
}

export async function listLocales(deps: Deps, ctx: CallContext): Promise<Result<string[]>> {
  const denied = requirePermission(ctx, 'settings.manage');
  return denied ?? ok(readLocales(deps));
}

export async function addLocale(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<string[]>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, codeSchema, input);
  if (!parsed.ok) return parsed;
  const current = readLocales(deps);
  if (current.includes(parsed.value.code)) return conflict('duplicateLocale', `${parsed.value.code} ist bereits eingerichtet`);
  if (current.length >= 10) return conflict('tooManyLocales', 'Höchstens zehn Sprachen');
  const next = [...current, parsed.value.code];
  deps.db.transaction((tx) => {
    tx.insert(settings)
      .values({ key: 'i18n.locales', value: JSON.stringify(next), updatedAt: isoNow(deps.clock), updatedByUserId: ctx.userId })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify(next), updatedAt: isoNow(deps.clock), updatedByUserId: ctx.userId },
      })
      .run();
    recordAudit(tx, deps, ctx, {
      action: 'locale.add',
      entityType: 'locale',
      entityId: parsed.value.code,
      before: current,
      after: next,
      summary: `Sprache ${parsed.value.code} hinzugefügt`,
    });
  });
  return ok(next);
}

export async function reorderLocales(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<string[]>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, orderSchema, input);
  if (!parsed.ok) return parsed;
  const current = readLocales(deps);
  const next = parsed.value.codes;
  const same = next.length === current.length && new Set(next).size === next.length && next.every((c) => current.includes(c));
  if (!same) return conflict('unknownLocale', 'Die Liste muss dieselben Sprachen enthalten');
  deps.db.transaction((tx) => {
    tx.insert(settings)
      .values({ key: 'i18n.locales', value: JSON.stringify(next), updatedAt: isoNow(deps.clock), updatedByUserId: ctx.userId })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify(next), updatedAt: isoNow(deps.clock), updatedByUserId: ctx.userId },
      })
      .run();
    recordAudit(tx, deps, ctx, {
      action: 'locale.reorder',
      entityType: 'locale',
      entityId: next[0]!,
      before: current,
      after: next,
      summary: 'Sprachen neu geordnet',
    });
  });
  return ok(next);
}

/** Zählt je mehrsprachiger Spalte, wie viele Zeilen in dieser Sprache Text tragen. */
function countFilled(deps: Deps, code: string): { tables: LocaleRemovalPreview['tables']; filled: number } {
  const existingTables = new Set(
    (deps.sqlite.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  const seen = new Set<string>();
  const tables: LocaleRemovalPreview['tables'] = [];
  for (const { table, column } of LOCALIZED_COLUMNS) {
    const key = `${table}.${column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!existingTables.has(table)) continue;
    const row = deps.sqlite
      .prepare(`select count(*) as n from "${table}" where coalesce(json_extract("${column}", '$."${code}"'), '') <> ''`)
      .get() as { n: number };
    if (row.n > 0) {
      tables.push({ table, column, filled: row.n });
    }
  }
  return { tables, filled: tables.reduce((sum, t) => sum + t.filled, 0) };
}

export async function previewLocaleRemoval(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<LocaleRemovalPreview>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, codeSchema, input);
  if (!parsed.ok) return parsed;
  const { code } = parsed.value;
  if (!readLocales(deps).includes(code)) return conflict('unknownLocale', `${code} ist nicht eingerichtet`);
  return ok({ code, ...countFilled(deps, code) });
}

export async function removeLocale(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<string[]>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, removeSchema, input);
  if (!parsed.ok) return parsed;
  const { code, confirm } = parsed.value;
  const current = readLocales(deps);
  if (!current.includes(code)) return conflict('unknownLocale', `${code} ist nicht eingerichtet`);
  if (current.length === 1) return conflict('lastLocale', 'Die letzte Sprache kann nicht entfernt werden');
  if (!confirm) return invalid([{ path: 'confirm', message: 'confirmationRequired' }]);
  const { filled } = countFilled(deps, code);
  const next = current.filter((c) => c !== code);
  const existingTables = new Set(
    (deps.sqlite.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  const seen = new Set<string>();
  deps.db.transaction((tx) => {
    for (const { table, column } of LOCALIZED_COLUMNS) {
      const key = `${table}.${column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (existingTables.has(table)) {
        deps.sqlite.prepare(`update "${table}" set "${column}" = json_remove("${column}", '$."${code}"')`).run();
      }
    }
    tx.insert(settings)
      .values({ key: 'i18n.locales', value: JSON.stringify(next), updatedAt: isoNow(deps.clock), updatedByUserId: ctx.userId })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify(next), updatedAt: isoNow(deps.clock), updatedByUserId: ctx.userId },
      })
      .run();
    recordAudit(tx, deps, ctx, {
      action: 'locale.remove',
      entityType: 'locale',
      entityId: code,
      before: { locales: current, filled },
      after: { locales: next },
      summary: `Sprache ${code} entfernt`,
    });
  });
  return ok(next);
}
