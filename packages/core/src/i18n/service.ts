import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import { settings } from '../db/schema';
import type { Deps } from '../deps';
import { requirePermission } from '../permissions/check';
import { conflict, invalid, ok, type Result } from '../result';
import { validate } from '../validate';
import { LOCALE_CODE, readLocales } from './locales';
import { countLocale, stripLocale } from './values';

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
/**
 * Tabellen, die ein Sprachwechsel nicht anfassen darf. Das Änderungsprotokoll
 * hält fest, was einmal da war — würde es mitbereinigt, verlöre der Eintrag
 * über das Entfernen selbst seinen Gegenstand.
 */
const UNTOUCHED_TABLES = new Set(['audit_log', '__drizzle_migrations']);

const looksLikeJson = (value: unknown): value is string =>
  typeof value === 'string' && (value.startsWith('{') || value.startsWith('['));

/**
 * Geht jede Zeile jeder Tabelle durch und behandelt mehrsprachige Werte, wo
 * immer sie liegen — als ganze Spalte, in einem Baustein, in einer Einstellung
 * oder in einem Sammlungseintrag, dessen Form erst ein Template festlegt.
 *
 * Eine Registrierung je Spalte trüge nur, solange die Struktur im Quelltext
 * steht; sobald ein Template die Felder bestimmt, wüsste niemand mehr, wo zu
 * suchen ist.
 */
function scanLocale(
  deps: Deps,
  code: string,
  opts: { write: boolean },
): { tables: LocaleRemovalPreview['tables']; filled: number } {
  const locales = readLocales(deps);
  const tables: LocaleRemovalPreview['tables'] = [];
  const names = (deps.sqlite.prepare("select name from sqlite_master where type='table'").all() as { name: string }[])
    .map((r) => r.name)
    .filter((name) => !UNTOUCHED_TABLES.has(name) && !name.startsWith('sqlite_'));

  for (const table of names) {
    const columns = (deps.sqlite.prepare(`pragma table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
    const rows = deps.sqlite.prepare(`select rowid as __rowid, * from "${table}"`).all() as Record<string, unknown>[];
    const perColumn = new Map<string, number>();

    for (const row of rows) {
      for (const column of columns) {
        const raw = row[column];
        if (!looksLikeJson(raw)) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }
        const found = countLocale(parsed, code, locales);
        if (found > 0) perColumn.set(column, (perColumn.get(column) ?? 0) + found);
        if (!opts.write) continue;
        const stripped = stripLocale(parsed, code, locales);
        if (stripped !== parsed) {
          deps.sqlite.prepare(`update "${table}" set "${column}" = ? where rowid = ?`).run(JSON.stringify(stripped), row.__rowid as number);
        }
      }
    }
    for (const [column, filled] of perColumn) tables.push({ table, column, filled });
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
  return ok({ code, ...scanLocale(deps, code, { write: false }) });
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
  const { filled } = scanLocale(deps, code, { write: false });
  const next = current.filter((c) => c !== code);
  deps.db.transaction((tx) => {
    // Erst bereinigen, dann die Liste kürzen: scanLocale erkennt mehrsprachige
    // Werte daran, dass alle ihre Schlüssel eingerichtete Sprachen sind.
    scanLocale(deps, code, { write: true });
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
