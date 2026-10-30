import { requirePermission } from '@kompass/core';
import { listOrgans, listResolutionRows, RESOLUTION_KINDS, type ResolutionKind } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { ResolutionList } from './resolution-list';

type Query = { organ?: string; kind?: string; year?: string; tax?: string };

/** Beschlüsse (Board 6a): alle Organe, aus Sitzungen und Umläufen; Filter in der Adresse. */
export default async function ResolutionsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.read')) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const t = await getTranslations('governance');
  const q = await searchParams;
  const year = q.year && /^\d{4}$/.test(q.year) ? Number(q.year) : undefined;
  const kind = (RESOLUTION_KINDS as readonly string[]).includes(q.kind ?? '') ? (q.kind as ResolutionKind) : undefined;
  const [all, rows, organs] = await Promise.all([
    listResolutionRows(deps, ctx, {}),
    listResolutionRows(deps, ctx, { ...(q.organ ? { organId: q.organ } : {}), ...(year ? { year } : {}), ...(kind ? { kinds: [kind] } : {}), ...(q.tax === '1' ? { taxRelevant: true } : {}) }),
    listOrgans(deps, ctx, { includeInactive: true }),
  ]);
  if (!all.ok || !rows.ok || !organs.ok) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const header = <PageHeader title={t('resolutions.title')} description={t('resolutions.description')} />;
  if (all.value.length === 0) {
    return (
      <Page width="standard" header={header}>
        <EmptyState title={t('resolutions.emptyTitle')} text={t('resolutions.emptyText')} />
      </Page>
    );
  }
  const years = [...new Set(all.value.map((r) => r.decidedOn.slice(0, 4)))].sort().reverse();
  return (
    <Page width="full" header={header}>
      <ResolutionList rows={rows.value} total={all.value.length} organs={organs.value.map((o) => ({ id: o.id, name: o.name }))} kinds={RESOLUTION_KINDS.map((k) => ({ value: k, label: '' }))} years={years} />
    </Page>
  );
}
