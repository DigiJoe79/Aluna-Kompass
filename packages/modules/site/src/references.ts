import type { Deps, MediaReference } from '@kompass/core';
import { widgetOf } from './field-schema';
import { siteEntries } from './schema';
import { activeTemplate } from './service';
import type { FieldSchema } from './types';
import { readValues } from './values';

/** Feldschlüssel eines Objekts, die im Schema als Asset deklariert sind. */
function assetKeys(fields: Record<string, FieldSchema>): string[] {
  return Object.entries(fields)
    .filter(([, f]) => widgetOf(f) === 'asset')
    .map(([key]) => key);
}

/** Wo ein Asset in einer Template-Variablen oder einem Sammlungseintrag steckt. */
export function siteMediaReferences(deps: Deps, assetId: string): MediaReference[] {
  const template = activeTemplate(deps);
  if (!template) return [];
  const refs: MediaReference[] = [];

  const values = readValues(deps);
  for (const key of assetKeys(template.schema.variables)) {
    if (values[key] === assetId) refs.push({ label: `Variable „${key}“`, entity: 'siteValue', id: key });
  }

  const collections = template.schema.collections;
  for (const row of deps.db.select().from(siteEntries).all()) {
    const col = collections[row.collection];
    if (!col) continue;
    const data = row.data as Record<string, unknown>;
    for (const key of assetKeys(col.fields)) {
      if (data[key] === assetId) {
        const title =
          row.slug ??
          (data.title && typeof data.title === 'object' ? Object.values(data.title as Record<string, string>)[0] : null) ??
          row.id;
        refs.push({ label: `Eintrag „${title}“ in „${col.label}“`, entity: 'siteEntry', id: row.id });
      }
    }
  }
  return refs;
}
