import { readLocales, requirePermission, type CallContext, type Deps, type RecordLabelInput } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { entryLabel } from './entry-label';
import { siteEntries } from './schema';
import { activeTemplate } from './service';

/**
 * Ein Eintrag der Webseite, vor allem für die Spalte „Objekt“ im Änderungsprotokoll (Joe 2026-10-09): sein Titel in
 * der Standardsprache, wie die Liste ihn zeigt. Fällt die Beschriftung der Liste auf die ID zurück, gibt es keinen
 * Namen — die ID steht im Detail. Nicht aus `index.ts` exportieren (MCP-Paritätswächter).
 */
export function siteRecordLabels(deps: Deps, ctx: CallContext, entityType: string, id: string): RecordLabelInput | null {
  if (entityType === 'siteCollection') return collectionLabel(deps, ctx, id);
  if (entityType !== 'siteEntry') return null;
  const row = deps.db.select().from(siteEntries).where(eq(siteEntries.id, id)).get();
  if (!row) return { label: '', href: null, state: 'missing' };
  if (requirePermission(ctx, 'site.view')) return { label: '', href: null, state: 'forbidden' };
  const col = activeTemplate(deps)?.schema.collections[row.collection];
  const text = col ? entryLabel(col, row, readLocales(deps)[0]!) : (row.slug ?? '');
  return { label: text === row.id ? '' : text, href: `/site/c/${row.collection}/${id}`, state: 'ok' };
}

/** Eine Sammlung (`site.entry.reorder`) mit ihrer Beschriftung aus der Vorlage, wie die Oberfläche sie nennt. */
function collectionLabel(deps: Deps, ctx: CallContext, key: string): RecordLabelInput {
  const col = activeTemplate(deps)?.schema.collections[key];
  if (!col) return { label: '', href: null, state: 'missing' };
  if (requirePermission(ctx, 'site.view')) return { label: '', href: null, state: 'forbidden' };
  return { label: col.label, href: `/site/c/${key}`, state: 'ok' };
}
