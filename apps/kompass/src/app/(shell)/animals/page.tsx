import { hasPermission, requirePermission } from '@kompass/core';
import { listAnimals } from '@kompass/module-animals';
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

export default async function AnimalsPage(props: { searchParams: Promise<AnimalListQuery> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'animals.view')) return <Page width="full"><ForbiddenCard permission="animals.view" /></Page>;
  const q = await props.searchParams;
  const t = await getTranslations('animals.list');
  // Gefiltert und sortiert wird im Dienst; `animalListInput` überliest, was er nicht kennt.
  const result = await listAnimals(deps, ctx, animalListInput(q));
  if (!result.ok) return <Page width="full"><ForbiddenCard permission="animals.view" /></Page>;
  const { animals, total, reviewPending } = result.value;
  return (
    <Page width="full" header={<PageHeader title={t('title')} actions={<Link href="/animals/new" className={buttonVariants()}>{t('create')}</Link>} />}>
      {total === 0 && !hasListFilter(q) ? (
        <EmptyState title={t('emptyTitle')} text={t('emptyText')} />
      ) : (
        <AnimalList animals={animals} total={total} reviewPending={reviewPending} canExport={hasPermission(ctx, 'documents.export')} />
      )}
    </Page>
  );
}
