import { hasPermission, readSetting, requirePermission } from '@kompass/core';
import { listAnimals, listProposals, PROPOSALS_ENABLED_KEY, REVIEW_ON_MCP_WRITE_KEY } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { AnimalList } from './animal-list';
import { animalListInput, hasListFilter, type AnimalListQuery } from './list-params';
import { animalViewTabs } from './view-tabs';

export default async function AnimalsPage(props: { searchParams: Promise<AnimalListQuery> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'animals.view')) return <Page width="full"><ForbiddenCard permission="animals.view" /></Page>;
  const q = await props.searchParams;
  const t = await getTranslations('animals.list');
  // Gefiltert und sortiert wird im Dienst; `animalListInput` überliest, was er nicht kennt.
  const result = await listAnimals(deps, ctx, animalListInput(q));
  if (!result.ok) return <Page width="full"><ForbiddenCard permission="animals.view" /></Page>;
  const { animals, total, reviewPending, tabCounts } = result.value;
  // Vorschläge nur mit `animals.manage` (die Lesedienste verlangen es); die Zahl am Reiter zählt alle offenen.
  const canManage = hasPermission(ctx, 'animals.manage');
  const proposals = canManage ? await listProposals(deps, ctx, { state: 'open' }) : null;
  const openProposals = proposals?.ok ? proposals.value.open.count : 0;
  const proposalAnimalIds = proposals?.ok ? [...new Set(proposals.value.proposals.flatMap((p) => (p.animalId ? [p.animalId] : [])))] : [];
  const views = animalViewTabs({
    canManage,
    reviewSetting: readSetting<boolean>(deps, REVIEW_ON_MCP_WRITE_KEY) === true,
    reviewPendingTotal: reviewPending,
    proposalsSetting: readSetting<boolean>(deps, PROPOSALS_ENABLED_KEY) === true,
    openProposals,
  });
  return (
    <Page width="full" header={<PageHeader title={t('title')} actions={<Link href="/animals/new" className={buttonVariants()}>{t('create')}</Link>} />}>
      {total === 0 && !hasListFilter(q) ? (
        <EmptyState title={t('emptyTitle')} text={t('emptyText')} />
      ) : (
        <AnimalList animals={animals} total={total} reviewPending={reviewPending} tabCounts={tabCounts} canExport={hasPermission(ctx, 'documents.export')} views={views} openProposals={openProposals} proposalAnimalIds={proposalAnimalIds} />
      )}
    </Page>
  );
}
