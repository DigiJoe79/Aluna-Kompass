import { hasPermission, requirePermission } from '@kompass/core';
import { getProposal, listProposals, MAX_ANIMAL_PHOTOS } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { queuePosition } from '@/lib/queue-position';
import { requireSession } from '@/lib/request-context';
import { QueueNav } from '../../queue-nav';
import { proposalListInput, proposalQueryString, type ProposalListQuery } from '../list-params';
import { PreviewSheet } from './preview-sheet';
import { ReviewMeta } from './review-meta';
import { CreateReview } from './create-review';
import { NoticeReview } from './notice-review';
import { SameAsReview } from './same-as-review';
import { UpdateReview } from './update-review';

/**
 * Prüfseite eines Vorschlags (Spec § 6): verzweigt je Art; „n von m“ blättert durch die Auswahl der Inbox. Nur mit
 * `animals.manage` — die Lesedienste verlangen es.
 */
export default async function ProposalPage(props: { params: Promise<{ id: string }>; searchParams: Promise<ProposalListQuery> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'animals.manage')) return <Page width="standard"><ForbiddenCard permission="animals.manage" /></Page>;
  const { id } = await props.params;
  const q = await props.searchParams;
  const review = await getProposal(deps, ctx, id);
  if (!review.ok) notFound();
  const t = await getTranslations('animals.proposals');
  const query = proposalQueryString(q);
  const list = await listProposals(deps, ctx, proposalListInput(q));
  const position = list.ok ? queuePosition(list.value.proposals.map((p) => p.id), id) : null;
  const back = { href: `/animals/proposals${query ? `?${query}` : ''}`, label: t('review.backToProposals') };
  // Weiter heißt: der nächste offene der Auswahl; am Ende zurück zur Inbox (Board 6).
  const nextHref = position?.nextId ? `/animals/proposals/${position.nextId}${query ? `?${query}` : ''}` : back.href;
  const { proposal, animal } = review.value;
  const name = animal?.name ?? proposal.name;
  const decided = proposal.state !== 'open';
  const state = proposal.kind === 'notice' && proposal.state === 'accepted' ? t('states.acknowledged') : t(`states.${proposal.state}`);
  // Vorschau nur für Änderung und neuen Hund, solange offen (Board 2a, 4a, 7b).
  const preview = !decided && (proposal.kind === 'update' || proposal.kind === 'create') ? <PreviewSheet proposalId={proposal.id} name={name} kind={proposal.kind} /> : null;
  const header = (title: string) => (
    <PageHeader
      title={title}
      back={back}
      status={decided ? <StatusBadge tone={proposal.state === 'accepted' || proposal.state === 'acceptedWithChanges' ? 'success' : 'neutral'}>{state}</StatusBadge> : undefined}
      actions={
        <>
          {preview}
          <QueueNav key={id} queue={{ query, position }} basePath="/animals/proposals" keepTab={false} />
        </>
      }
    />
  );
  const common = { review: review.value, locales: deps.locales(), nextHref, backHref: back.href, canFollowUp: hasPermission(ctx, 'followUps.manage') };
  switch (proposal.kind) {
    case 'update':
      return (
        <Page width="standard" header={header(t('review.titleUpdate', { name }))}>
          <ReviewMeta review={review.value} />
          {proposal.cleared ? null : <UpdateReview {...common} maxPhotos={MAX_ANIMAL_PHOTOS} />}
        </Page>
      );
    case 'create':
      return (
        <Page width="standard" header={header(t('review.titleCreate', { name: name || t('unnamed') }))}>
          <ReviewMeta review={review.value} />
          {decided ? null : <CreateReview {...common} maxPhotos={MAX_ANIMAL_PHOTOS} />}
        </Page>
      );
    case 'notice':
      return (
        <Page width="task" header={header(t('review.titleNotice', { name }))}>
          <ReviewMeta review={review.value} />
          {decided || !animal ? null : <NoticeReview review={review.value} nextHref={nextHref} />}
        </Page>
      );
    case 'sameAs':
      return (
        <Page width="standard" header={header(t('review.titleSameAs', { proposed: proposal.proposedName || name, name }))}>
          <ReviewMeta review={review.value} />
          {decided || !animal ? null : <SameAsReview review={review.value} locales={deps.locales()} nextHref={nextHref} />}
        </Page>
      );
  }
}
