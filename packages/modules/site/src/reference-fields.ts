import { conflict, ok, type Deps, type PublishedView, type Result } from '@kompass/core';
import type { z } from 'zod';
import type { FieldSchema, TemplateSchema } from './types';

/**
 * Referenzfelder: eine Variable, die auf einen Datensatz einer veröffentlichten
 * Sicht zeigt (Spec 2026-09-13, § 3 und § 4). Alles, was Sicht, Bedingung und
 * Beschriftung betrifft, steht hier einmal — Maske, Dienst, Einlesen und
 * Export rufen dieselben Funktionen.
 */

export interface ReferenceFieldMeta {
  view: string;
  key: string;
  labelField: string;
  where?: Record<string, unknown>;
  multiple: boolean;
  max?: number;
}

export interface ReferenceOption {
  value: string;
  label: string;
}

export interface StaleReference {
  field: string;
  value: string;
}

export function referenceMetaOf(field: FieldSchema): ReferenceFieldMeta | null {
  if (field.widget !== 'reference' && field.widget !== 'references') return null;
  const f = field as { view?: unknown; key?: unknown; labelField?: unknown; where?: unknown; maxItems?: unknown };
  return {
    view: typeof f.view === 'string' ? f.view : '',
    key: typeof f.key === 'string' ? f.key : 'slug',
    labelField: typeof f.labelField === 'string' ? f.labelField : 'name',
    where: f.where && typeof f.where === 'object' && !Array.isArray(f.where) ? (f.where as Record<string, unknown>) : undefined,
    multiple: field.widget === 'references',
    max: typeof f.maxItems === 'number' ? f.maxItems : undefined,
  };
}

/** Die Sicht mit diesem Namen — aus dem Kern oder aus einem Modul, das `uses` nennt. */
export function findView(deps: Deps, uses: string[], name: string): { view: PublishedView; moduleKey: string } | null {
  for (const manifest of deps.registry.manifests) {
    if (manifest.key !== 'core' && !uses.includes(manifest.key)) continue;
    const view = manifest.publishedViews?.find((v) => v.name === name);
    if (view) return { view, moduleKey: manifest.key };
  }
  return null;
}

const isPresentClause = (v: unknown): boolean => !!v && typeof v === 'object' && (v as { present?: unknown }).present === true;

/** Gleichheit auf einen Skalar oder `{ present: true }`; mehrere Einträge sind ein Und. */
export function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  for (const [field, expected] of Object.entries(where ?? {})) {
    const actual = row[field];
    if (isPresentClause(expected)) {
      if (actual === null || actual === undefined) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

function labelOf(row: Record<string, unknown>, labelField: string, locales: readonly string[]): string {
  const raw = row[labelField];
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const text = raw as Record<string, string>;
    for (const locale of locales) if (text[locale]) return text[locale]!;
    return Object.values(text).find((v) => typeof v === 'string' && v.length > 0) ?? '';
  }
  return raw === null || raw === undefined ? '' : String(raw);
}

/** Die wählbaren Datensätze eines Referenzfelds, in der Reihenfolge der Sicht. */
export function resolveReferenceOptions(deps: Deps, uses: string[], field: FieldSchema): ReferenceOption[] {
  const meta = referenceMetaOf(field);
  if (!meta) return [];
  const found = findView(deps, uses, meta.view);
  if (!found) return [];
  const locales = deps.locales();
  return (found.view.load(deps) as Record<string, unknown>[])
    .filter((row) => matchesWhere(row, meta.where))
    .map((row) => ({ value: String(row[meta.key] ?? ''), label: labelOf(row, meta.labelField, locales) }))
    .filter((option) => option.value.length > 0);
}

const valuesOf = (meta: ReferenceFieldMeta, raw: unknown): unknown[] => {
  if (meta.multiple) return Array.isArray(raw) ? raw : [];
  return raw === null || raw === undefined || raw === '' ? [] : [raw];
};

/** Jeder gespeicherte Wert, der nicht (mehr) unter den Optionen steht. */
export function checkReferenceValues(deps: Deps, schema: TemplateSchema, values: Record<string, unknown>): StaleReference[] {
  const stale: StaleReference[] = [];
  for (const [field, fieldSchema] of Object.entries(schema.variables)) {
    const meta = referenceMetaOf(fieldSchema);
    if (!meta || !(field in values)) continue;
    const allowed = new Set(resolveReferenceOptions(deps, schema.uses, fieldSchema).map((o) => o.value));
    for (const value of valuesOf(meta, values[field])) {
      if (typeof value !== 'string' || !allowed.has(value)) stale.push({ field, value: String(value) });
    }
  }
  return stale;
}

/** Felder, in denen derselbe Datensatz zweimal gewählt ist. */
export function duplicateReferences(schema: TemplateSchema, values: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [field, fieldSchema] of Object.entries(schema.variables)) {
    const meta = referenceMetaOf(fieldSchema);
    if (!meta?.multiple || !(field in values)) continue;
    const list = valuesOf(meta, values[field]);
    if (new Set(list).size !== list.length) out.push(field);
  }
  return out;
}

/**
 * Beim Einlesen: Die Sicht muss es geben, und `key`, `labelField` und jedes
 * Feld in `where` müssen in ihrem Schema stehen. Erst hier ist die Registry
 * bekannt; `defineTemplate` kann das nicht prüfen.
 */
export function checkReferenceFields(deps: Deps, schema: TemplateSchema): Result<null> {
  for (const [field, fieldSchema] of Object.entries(schema.variables)) {
    const meta = referenceMetaOf(fieldSchema);
    if (!meta) continue;
    const found = findView(deps, schema.uses, meta.view);
    if (!found) {
      return conflict('unknownView', `Die Variable „${field}“ verweist auf die Sicht „${meta.view}“, die weder der Kern noch ein Modul aus uses liefert`);
    }
    const shape = ((found.view.schema as unknown as z.ZodObject<z.ZodRawShape>).shape ?? {}) as Record<string, unknown>;
    for (const name of [meta.key, meta.labelField, ...Object.keys(meta.where ?? {})]) {
      if (!(name in shape)) {
        return conflict('unknownViewField', `Die Variable „${field}“ nennt das Feld „${name}“, das die Sicht „${meta.view}“ nicht hat`);
      }
    }
  }
  return ok(null);
}
