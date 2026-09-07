import { type DbOrTx, type Deps, isoNow } from '@kompass/core';
import { eq } from 'drizzle-orm';
import type { TemplateSchema } from '../load';
import { siteEntries, siteValues } from '../schema';
import type { Finding } from './plan';

const variableName = (path: string) => /^variables\.(.+)$/.exec(path)?.[1];
const collectionName = (path: string) => /^collections\.([^.[\]]+)$/.exec(path)?.[1];
const collectionField = (path: string) => {
  const m = /^collections\.([^.[\]]+)\[\]\.(.+)$/.exec(path);
  return m ? { collection: m[1]!, field: m[2]! } : undefined;
};

/** Der Leerwert eines Typs — was ein verlustbehafteter Wechsel hinterlässt. */
const emptyOf = (kind: string): unknown => {
  switch (kind) {
    case 'list':
      return [];
    case 'number':
      return 0;
    case 'asset':
      return null;
    case 'localized':
      return {};
    default:
      return '';
  }
};

/** Eine verlustfreie Umformung: Text → Liste wird einelementig, Zahl → Text zur Zeichenkette. */
const recast = (value: unknown, from: string, to: string): unknown => {
  if (from === 'text' && to === 'list') return value === undefined || value === null || value === '' ? [] : [value];
  if (from === 'number' && to === 'text') return value === undefined || value === null ? '' : String(value);
  return value;
};

/**
 * Wendet einen bestätigten Resync-Plan in der übergebenen Transaktion an.
 * `overLimit` erreicht diese Stelle nicht — es blockiert bereits die
 * Bestätigung.
 */
// schemaAfter ist Teil der Signatur für spätere Nachprüfungen; die Wirkung je
// Befund trägt sich aus dem Befund selbst.
export function applyFindings(tx: DbOrTx, deps: Deps, findings: Finding[], schemaAfter: TemplateSchema): void {
  void schemaAfter;
  const now = isoNow(deps.clock);

  const setVariable = (key: string, value: unknown) =>
    tx
      .insert(siteValues)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: siteValues.key, set: { value, updatedAt: now } })
      .run();

  const mapEntries = (collection: string, fn: (data: Record<string, unknown>) => Record<string, unknown> | null) => {
    const rows = tx.select().from(siteEntries).where(eq(siteEntries.collection, collection)).all();
    for (const row of rows) {
      const next = fn({ ...(row.data as Record<string, unknown>) });
      if (next === null) continue;
      tx.update(siteEntries).set({ data: next, updatedAt: now }).where(eq(siteEntries.id, row.id)).run();
    }
  };

  for (const finding of findings) {
    switch (finding.kind) {
      case 'added':
      case 'overLimit':
        break;

      case 'renamed': {
        const toVar = variableName(finding.path);
        const fromVar = variableName(finding.from);
        if (toVar && fromVar) {
          const existing = tx.select().from(siteValues).where(eq(siteValues.key, fromVar)).get();
          if (existing) {
            setVariable(toVar, existing.value);
            tx.delete(siteValues).where(eq(siteValues.key, fromVar)).run();
          }
          break;
        }
        const toField = collectionField(finding.path);
        const fromField = collectionField(finding.from);
        if (toField && fromField) {
          mapEntries(toField.collection, (data) => {
            if (!(fromField.field in data)) return null;
            data[toField.field] = data[fromField.field];
            delete data[fromField.field];
            return data;
          });
        }
        break;
      }

      case 'removed': {
        const v = variableName(finding.path);
        if (v) {
          tx.delete(siteValues).where(eq(siteValues.key, v)).run();
          break;
        }
        const c = collectionName(finding.path);
        if (c) {
          tx.delete(siteEntries).where(eq(siteEntries.collection, c)).run();
          break;
        }
        const f = collectionField(finding.path);
        if (f) {
          mapEntries(f.collection, (data) => {
            if (!(f.field in data)) return null;
            delete data[f.field];
            return data;
          });
        }
        break;
      }

      case 'retyped': {
        const cast = (value: unknown) => (finding.lossless ? recast(value, finding.from, finding.to) : emptyOf(finding.to));
        const v = variableName(finding.path);
        if (v) {
          const row = tx.select().from(siteValues).where(eq(siteValues.key, v)).get();
          if (row) setVariable(v, cast(row.value));
          break;
        }
        const f = collectionField(finding.path);
        if (f) {
          mapEntries(f.collection, (data) => {
            data[f.field] = cast(data[f.field]);
            return data;
          });
        }
        break;
      }

      case 'valueGone': {
        const v = variableName(finding.path);
        if (v) {
          const row = tx.select().from(siteValues).where(eq(siteValues.key, v)).get();
          if (row && row.value === finding.value) setVariable(v, finding.replacement);
          break;
        }
        const f = collectionField(finding.path);
        if (f) {
          mapEntries(f.collection, (data) => {
            if (data[f.field] !== finding.value) return null;
            data[f.field] = finding.replacement;
            return data;
          });
        }
        break;
      }
    }
  }
}
