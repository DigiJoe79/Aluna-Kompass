import { notFound, ok, readLocales, readPath, requirePermission, writePath, type CallContext, type Deps, type LocalizedValue, type Result, type Translatable, type TranslationWrite } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { updateEntry } from './entries';
import { widgetOf } from './field-schema';
import { siteEntries } from './schema';
import { activeTemplate } from './service';
import type { CollectionSchema, FieldSchema } from './types';
import { readValues, setValues } from './values';

const LABEL_WIDGETS = ['text', 'localized', 'markdown'];

/**
 * Wie die Listenseite einen Eintrag beschriftet: erstes textartiges Feld in
 * der Leitsprache, sonst Slug, sonst ID. Eine Regel für Maske und MCP.
 */
export function entryLabel(col: CollectionSchema, entry: { id: string; slug: string | null; data: unknown }, leading: string): string {
  const labelField = Object.entries(col.fields).find(([, f]) => LABEL_WIDGETS.includes(widgetOf(f)))?.[0];
  const data = (entry.data ?? {}) as Record<string, unknown>;
  const raw = labelField ? data[labelField] : undefined;
  const text = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? String((raw as Record<string, string>)[leading] ?? '') : '';
  return text || entry.slug || entry.id;
}

const isLocalizedMap = (v: unknown): v is Record<string, LocalizedValue> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Jede `localized`-Stelle eines Wertes, auch in `objectList`, als Pfad → Sprachmap. */
export function localizedPaths(fields: Record<string, FieldSchema>, value: Record<string, unknown>, prefix = ''): Record<string, Record<string, LocalizedValue>> {
  const out: Record<string, Record<string, LocalizedValue>> = {};
  for (const [key, field] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const v = value[key];
    const widget = widgetOf(field);
    if (widget === 'localized' && isLocalizedMap(v)) out[path] = v;
    if (widget === 'objectList' && Array.isArray(v)) {
      const props = (field as { items?: { properties?: Record<string, FieldSchema> } }).items?.properties ?? {};
      v.forEach((item, i) => {
        if (item && typeof item === 'object') Object.assign(out, localizedPaths(props, item as Record<string, unknown>, `${path}[${i}]`));
      });
    }
  }
  return out;
}

/** Variablen als ein Datensatz, dazu jeder Eintrag jeder Sammlung — alle nur in den Sprachen des Templates. */
export function siteTranslatables(deps: Deps, ctx: CallContext): Result<Translatable[]> {
  const denied = requirePermission(ctx, 'site.view');
  if (denied) return denied;
  const template = activeTemplate(deps);
  if (!template) return ok([]);
  const leading = readLocales(deps)[0]!;
  const locales = template.schema.locales;
  const out: Translatable[] = [
    { entityType: 'site.variables', id: 'variables', label: template.schema.name, href: '/site/variables', locales, fields: localizedPaths(template.schema.variables, readValues(deps)) },
  ];
  for (const [key, col] of Object.entries(template.schema.collections)) {
    const rows = deps.db.select().from(siteEntries).where(eq(siteEntries.collection, key)).orderBy(asc(siteEntries.sortOrder)).all();
    for (const row of rows) {
      out.push({ entityType: 'site.entry', id: row.id, label: entryLabel(col, row, leading), href: `/site/c/${key}/${row.id}`, locales, fields: localizedPaths(col.fields, row.data as Record<string, unknown>) });
    }
  }
  return ok(out);
}

/** Setzt je Position den einen Sprachschlüssel; liefert die geänderten Top-Level-Schlüssel oder den ersten fehlenden Pfad. */
function patch(root: Record<string, unknown>, items: TranslationWrite['items']): { next: Record<string, unknown>; touched: string[] } | { missing: string } {
  let next = root;
  const touched = new Set<string>();
  for (const item of items) {
    const current = readPath(next, item.field);
    if (!isLocalizedMap(current)) return { missing: item.field };
    const written = writePath(next, item.field, { ...current, [item.locale]: item.text });
    if (!written) return { missing: item.field };
    next = written;
    touched.add(item.field.split(/[.[]/)[0]!);
  }
  return { next, touched: [...touched] };
}

const pick = (obj: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

/** Variablen über `setValues` (nur die berührten Variablen), Einträge über `updateEntry` (nur die berührten Felder). */
export function siteSetTranslations(deps: Deps, ctx: CallContext, input: TranslationWrite): Promise<Result<unknown>> | null {
  if (input.entityType !== 'site.variables' && input.entityType !== 'site.entry') return null;
  return (async () => {
    const denied = requirePermission(ctx, 'site.manage');
    if (denied) return denied;
    if (input.entityType === 'site.variables') {
      const patched = patch(readValues(deps), input.items);
      if ('missing' in patched) return notFound('field', patched.missing);
      return setValues(deps, ctx, { values: pick(patched.next, patched.touched) });
    }
    const row = deps.db.select().from(siteEntries).where(eq(siteEntries.id, input.id)).get();
    if (!row) return notFound('siteEntry', input.id);
    const patched = patch(row.data as Record<string, unknown>, input.items);
    if ('missing' in patched) return notFound('field', patched.missing);
    return updateEntry(deps, ctx, { id: input.id, data: pick(patched.next, patched.touched) });
  })();
}
