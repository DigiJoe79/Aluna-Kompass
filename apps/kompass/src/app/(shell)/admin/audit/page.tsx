import { getAuditEntry, hasPermission, listAuditActions, listUsers, queryAudit, requirePermission } from '@kompass/core';
import { getLocale, getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { ListPager } from '@/components/list-pager';
import { auditActionLabel } from '@/lib/audit-actions';
import { auditEntityLabels, auditObject } from '@/lib/audit-entities';
import { auditSentences, labelsFrom, type SentenceTranslator } from '@/lib/audit-sentences';
import { dateFormatOf } from '@/lib/date-format';
import { requireSession } from '@/lib/request-context';
import { ExportButton } from './export-button';
import { AuditDetail } from './audit-detail';
import { AuditFilters } from './audit-filters';
import { AuditTable } from './audit-table';

const PAGE = 50;

export default async function AuditPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'audit.view')) return <Page width="full"><ForbiddenCard permission="audit.view" /></Page>;
  const t = await getTranslations('audit');
  const sp = await props.searchParams;
  const offset = Number(sp.offset ?? 0) || 0;
  const result = queryAudit(deps, ctx, {
    userId: sp.userId || undefined,
    channel: (sp.channel as 'ui' | 'mcp' | 'system') || undefined,
    action: sp.action || undefined,
    text: sp.text || undefined,
    from: sp.from ? `${sp.from}T00:00:00.000Z` : undefined,
    to: sp.to ? `${sp.to}T23:59:59.999Z` : undefined,
    limit: PAGE,
    offset,
  });
  if (!result.ok) return <Page width="full"><ForbiddenCard permission="audit.view" /></Page>;
  const users = await listUsers(deps, ctx);
  // Alle vorkommenden Aktionen, in Worten (Spec Filterleisten § 4) — nicht nur die der letzten 200 Einträge.
  const actionsRes = listAuditActions(deps, ctx);
  const actions = (actionsRes.ok ? actionsRes.value : [])
    .map((value) => ({ value, label: auditActionLabel(t, value) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
  const filtered = Boolean(sp.userId || sp.channel || sp.action || sp.text || sp.from || sp.to);
  const all = filtered ? queryAudit(deps, ctx, { limit: 1 }) : result;
  const unfiltered = all.ok ? all.value.total : result.value.total;
  const selected = sp.entry ? getAuditEntry(deps, ctx, sp.entry) : null;
  // Der Satz entsteht erst hier, aus `audit.sentences.*` (Spec Protokoll § 4); ohne Satz steht der Klartext.
  const shown = [...result.value.entries, ...(selected?.ok ? [selected.value] : [])];
  const label = labelsFrom(await getTranslations());
  const locale = await getLocale();
  const sentences = auditSentences(deps, ctx, t as unknown as SentenceTranslator, shown, { paper: false, label, locale });
  // Das Objekt in Worten mit Namen (Joe 2026-10-09), für Tabelle und Detail.
  const objects = auditEntityLabels(deps, ctx, shown, { label, locale });
  const query = new URLSearchParams(
    Object.entries(sp).filter(([k, v]) => v && k !== 'entry' && k !== 'offset') as [string, string][]
  ).toString();
  return (
    <Page
      width="full"
      header={
        <PageHeader
          title={t('title')}
          actions={<ExportButton enabled={hasPermission(ctx, 'documents.export')} />}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <AuditFilters users={users.ok ? users.value.map((u) => ({ id: u.id, name: u.name })) : []} actions={actions} count={{ shown: result.value.total, total: unfiltered }} />
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <AuditTable
            entries={result.value.entries}
            selectedId={sp.entry ?? null}
            query={query}
            labels={objects}
            fmt={dateFormatOf(deps)}
            sentences={sentences}
            filtered={filtered ? { resetHref: '/admin/audit', peopleHint: Boolean(sp.text) && !sp.userId } : null}
          />
          <ListPager total={result.value.total} offset={offset} pageSize={PAGE} hrefFor={(next) => (next > 0 ? `?${query}${query ? '&' : ''}offset=${next}` : `?${query}`)} footer testId="audit-pager" />
        </div>
      </div>
      {selected?.ok ? <AuditDetail entry={selected.value} sentence={sentences[selected.value.id] ?? null} object={auditObject(t, selected.value, objects[selected.value.id])} /> : null}
    </Page>
  );
}
