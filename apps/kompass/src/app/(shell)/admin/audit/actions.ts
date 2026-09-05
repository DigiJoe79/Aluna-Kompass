'use server';

import { queryAudit, renderDocument } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function exportAuditPdfAction(filters: Record<string, string | undefined>): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const query = queryAudit(deps, ctx, {
    userId: filters.userId || undefined,
    channel: filters.channel || undefined,
    action: filters.action || undefined,
    text: filters.text || undefined,
    from: filters.from ? `${filters.from}T00:00:00.000Z` : undefined,
    to: filters.to ? `${filters.to}T23:59:59.999Z` : undefined,
    limit: 200,
  });
  if (!query.ok) return toActionState(query, t);
  const labels = t.raw('audit.filters') as Record<string, string>;
  const shown = Object.fromEntries(Object.entries(filters).filter(([k, v]) => v && k !== 'entry' && k !== 'offset').map(([k, v]) => [labels[k] ?? k, String(v)]));
  const result = await renderDocument(deps, ctx, {
    templateKey: 'audit-log-export',
    input: {
      title: t('audit.title'),
      filters: shown,
      entries: query.value.entries.map((e) => ({ occurredAt: e.occurredAt, userName: e.userName, channel: e.channel, action: e.action, entityType: e.entityType, entityId: e.entityId, summary: e.summary })),
    },
  });
  if (!result.ok) return toActionState(result, t);
  redirect(`/admin/documents?selected=${result.value.id}`);
}