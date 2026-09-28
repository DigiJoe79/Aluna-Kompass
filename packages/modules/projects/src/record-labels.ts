import { hasPermission, readLocales, type CallContext, type Deps, type LocalizedText, type RecordLabelInput } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { projects } from './schema';

export function projectsRecordLabels(deps: Deps, ctx: CallContext, entityType: string, id: string): RecordLabelInput | null {
  if (entityType !== 'project') return null;
  const row = deps.db.select().from(projects).where(eq(projects.id, id)).get();
  if (!row) return { label: '', href: null, state: 'missing' };
  if (!hasPermission(ctx, 'projects.view')) return { label: { key: 'projects.records.forbidden' }, href: null, state: 'forbidden' };
  const leading = readLocales(deps)[0]!;
  return { label: (row.name as LocalizedText)[leading] || row.slug, href: `/projects/${id}`, state: 'ok' };
}
