import type { AssetMediaReference, Deps } from '@kompass/core';
import { widgetOf } from './field-schema';
import { siteEntries } from './schema';
import { activeTemplate } from './service';
import type { FieldSchema } from './types';
import { readValues } from './values';

/** Feldschlüssel eines Objekts, die im Schema als Asset deklariert sind. */
export function assetKeys(fields: Record<string, FieldSchema>): string[] {
  return Object.entries(fields)
    .filter(([, f]) => widgetOf(f) === 'asset')
    .map(([key]) => key);
}

/** Wo Assets in Template-Variablen oder Sammlungseinträgen stecken — Template, Werte und Einträge je einmal gelesen. */
export function siteMediaReferences(deps: Deps, assetIds: ReadonlySet<string>): AssetMediaReference[] {
  const template = activeTemplate(deps);
  if (!template) return [];
  const refs: AssetMediaReference[] = [];

  const values = readValues(deps);
  for (const key of assetKeys(template.schema.variables)) {
    const assetId = values[key];
    if (typeof assetId === 'string' && assetIds.has(assetId)) refs.push({ assetId, label: `Variable „${key}“`, entity: 'siteValue', id: key, href: '/site/variables' });
  }

  const collections = template.schema.collections;
  for (const row of deps.db.select().from(siteEntries).all()) {
    const col = collections[row.collection];
    if (!col) continue;
    const data = row.data as Record<string, unknown>;
    for (const key of assetKeys(col.fields)) {
      const assetId = data[key];
      if (typeof assetId !== 'string' || !assetIds.has(assetId)) continue;
      const title =
        row.slug ??
        (data.title && typeof data.title === 'object' ? Object.values(data.title as Record<string, string>)[0] : null) ??
        row.id;
      refs.push({ assetId, label: `Eintrag „${title}“ in „${col.label}“`, entity: 'siteEntry', id: row.id, href: `/site/c/${row.collection}/${row.id}` });
    }
  }
  return refs;
}
