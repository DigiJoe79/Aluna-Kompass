import { readSetting, requirePermission } from '@kompass/core';
import { listAnimals, listProposals, PROPOSAL_STACK_KEY, PROPOSALS_ENABLED_KEY, REVIEW_ON_MCP_WRITE_KEY } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { animalViewTabs } from '../view-tabs';
import { proposalListInput, proposalQueryString, type ProposalListQuery } from './list-params';
import { ProposalList } from './proposal-list';

/**
 * Die Inbox der Vorschläge (Spec § 6, Board 1a): ein Reiter der Tierliste mit demselben Seitenkopf, eigener
 * Filterleiste und eigenen Spalten. Nur mit `animals.manage` — die Lesedienste verlangen es.
 */
export default async function ProposalsPage(props: { searchParams: Promise<ProposalListQuery> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'animals.manage')) return <Page width="full"><ForbiddenCard permission="animals.manage" /></Page>;
  const q = await props.searchParams;
  const t = await getTranslations('animals');
  const [list, animalsList] = await Promise.all([listProposals(deps, ctx, proposalListInput(q)), listAnimals(deps, ctx, {})]);
  if (!list.ok || !animalsList.ok) return <Page width="full"><ForbiddenCard permission="animals.manage" /></Page>;
  const views = animalViewTabs({
    canManage: true,
    reviewSetting: readSetting<boolean>(deps, REVIEW_ON_MCP_WRITE_KEY) === true,
    reviewPendingTotal: animalsList.value.reviewPending,
    proposalsSetting: readSetting<boolean>(deps, PROPOSALS_ENABLED_KEY) === true,
    openProposals: list.value.open.count,
  });
  const query = proposalQueryString(q);
  return (
    <Page
      width="full"
      header={
        <PageHeader
          title={t('list.title')}
          actions={
            <>
              {/* „Durchgehen“ secondary nur auf diesem Reiter; „Hund anlegen“ bleibt die Hauptaktion (Board 1a). Nur mit
                  eingeschaltetem Stapel (Einstellungen → Tiere, Vorgabe aus). */}
              {list.value.open.count > 0 && readSetting<boolean>(deps, PROPOSAL_STACK_KEY) === true ? (
                <Link href={`/animals/proposals/review${query ? `?${query}` : ''}`} className={buttonVariants({ variant: 'secondary' })}>
                  {t('proposals.walkThrough')}
                </Link>
              ) : null}
              <Link href="/animals/new" className={buttonVariants()}>{t('list.create')}</Link>
            </>
          }
        />
      }
    >
      <ProposalList list={list.value} totalAnimals={animalsList.value.total} reviewPending={animalsList.value.reviewPending} views={views} query={query} />
    </Page>
  );
}
