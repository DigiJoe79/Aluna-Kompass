import { nameOrEmpty, type AssetMediaReference, type Deps } from '@kompass/core';
import { assetValuesIn, assetValuesOf, type AssetValue } from './asset-values';
import { entryLabel } from './entry-label';
import { widgetOf } from './field-schema';
import { siteEntries } from './schema';
import { activeTemplate } from './service';
import type { FieldSchema } from './types';
import { readValues } from './values';

/** Feldschlüssel eines Objekts, die im Schema als Asset deklariert sind (oberste Ebene). */
export function assetKeys(fields: Record<string, FieldSchema>): string[] {
  return Object.entries(fields)
    .filter(([, f]) => widgetOf(f) === 'asset')
    .map(([key]) => key);
}

/** Eine Fundstelle je Asset und Datensatz; zugeschnitten, wenn einer der Werte dort einen Ausschnitt trägt. */
function perAsset(values: readonly AssetValue[], assetIds: ReadonlySet<string>): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const v of values) if (!v.malformed && assetIds.has(v.assetId)) out.set(v.assetId, (out.get(v.assetId) ?? false) || v.cropped);
  return out;
}

/**
 * Wo Assets in Template-Variablen oder Sammlungseinträgen stecken — Template, Werte und Einträge je einmal gelesen.
 * Gemeldet wird die Basis, auch für eine abgeleitete ID mit Ausschnitt und in Listen (Spec Ausschnitt § 3).
 */
export function siteMediaReferences(deps: Deps, assetIds: ReadonlySet<string>): AssetMediaReference[] {
  const template = activeTemplate(deps);
  if (!template) return [];
  const refs: AssetMediaReference[] = [];
  const leading = deps.locales()[0] ?? 'de';

  const values = readValues(deps);
  for (const [key, field] of Object.entries(template.schema.variables)) {
    for (const [assetId, cropped] of perAsset(assetValuesOf(field, values[key], key), assetIds)) {
      refs.push({ assetId, label: `Variable „${nameOrEmpty(field.label)}“`, entity: 'siteValue', id: key, href: '/site/variables', cropped });
    }
  }

  const collections = template.schema.collections;
  for (const row of deps.db.select().from(siteEntries).all()) {
    const col = collections[row.collection];
    if (!col) continue;
    const hits = perAsset(assetValuesIn(col.fields, row.data), assetIds);
    if (hits.size === 0) continue;
    const title = entryLabel(col, row, leading);
    for (const [assetId, cropped] of hits) {
      refs.push({ assetId, label: `Eintrag „${title}“ in „${col.label}“`, entity: 'siteEntry', id: row.id, href: `/site/c/${row.collection}/${row.id}`, cropped });
    }
  }
  return refs;
}
