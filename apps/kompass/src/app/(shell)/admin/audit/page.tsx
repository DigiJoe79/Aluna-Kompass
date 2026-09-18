import { getAuditEntry, hasPermission, listUsers, queryAudit, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { ExportButton } from './export-button';
import { AuditDetail } from './audit-detail';
import { AuditFilters } from './audit-filters';
import { AuditTable } from './audit-table';

const PAGE = 50;

export default async function AuditPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'audit.view')) return <ForbiddenCard permission="audit.view" />;
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
  if (!result.ok) return <ForbiddenCard permission="audit.view" />;
  const users = await listUsers(deps, ctx);
  const recent = queryAudit(deps, ctx, { limit: 200 });
  const actions = recent.ok ? [...new Set(recent.value.entries.map((e) => e.action))].sort() : [];
  const selected = sp.entry ? getAuditEntry(deps, ctx, sp.entry) : null;
  const query = new URLSearchParams(
    Object.entries(sp).filter(([k, v]) => v && k !== 'entry' && k !== 'offset') as [string, string][]
  ).toString();
  return (
    <>
      <PageHeader
        title={t('title')}
        actions={<ExportButton enabled={hasPermission(ctx, 'documents.export')} />}
      />
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <AuditFilters
          users={users.ok ? users.value.map((u) => ({ id: u.id, name: u.name })) : []}
          actions={actions}
          total={result.value.total}
        />
        <AuditTable entries={result.value.entries} selectedId={sp.entry ?? null} query={query} />
        <div className="flex items-center justify-between px-5 py-3 text-[13px] text-muted-ink">
          <span>
            {t('range', {
              from: Math.min(offset + 1, result.value.total),
              to: Math.min(offset + PAGE, result.value.total),
              total: result.value.total,
            })}
          </span>
          <div className="flex gap-2">
            {offset > 0 ? (
              <Link
                href={`?${query}&offset=${Math.max(0, offset - PAGE)}`}
                className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              >
                {t('prev')}
              </Link>
            ) : null}
            {offset + PAGE < result.value.total ? (
              <Link
                href={`?${query}&offset=${offset + PAGE}`}
                className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              >
                {t('next')}
              </Link>
            ) : null}
          </div>
        </div>
      </div>
      {selected?.ok ? <AuditDetail entry={selected.value} /> : null}
    </>
  );
}
