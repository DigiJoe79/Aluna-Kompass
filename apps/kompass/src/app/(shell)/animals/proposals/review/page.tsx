import { readSetting, requirePermission } from '@kompass/core';
import { getProposal, listProposals, PHOTO_FRAME_KEY, photoFrameStyle, PROPOSAL_STACK_KEY, type PhotoFrame, type ProposalReview } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { mediaPreviewUrl, proposalImageUrl } from '../../crop-frame';
import { fieldLabelKey, formatProposalValue } from '../field-format';
import { proposalListInput, proposalQueryString, type ProposalListQuery } from '../list-params';
import { rightAction } from './stack-route';
import { SwipeStack, type StackCard } from './swipe-stack';

const MAX_LINES = 6;
const SHORT = 80;
const cut = (s: string) => (s.length > SHORT ? `${s.slice(0, SHORT - 1)}…` : s);

/**
 * Titelbild der Karte: bei Änderung das künftige (vorgeschlagenes, sonst heutiges), bei neuem Hund das vorgeschlagene —
 * mit dem Ausschnitt der Fotozeile bzw. des Tierfotos und, soweit bekannt, dem Seitenverhältnis des ganzen Fotos.
 */
function imageOf(review: ProposalReview): StackCard['image'] {
  const rows = review.photos ?? [];
  const proposed = rows.find((r) => r.inProposal && r.proposedPrimary) ?? (review.proposal.kind === 'create' ? rows[0] : undefined);
  if (proposed) {
    return {
      url: proposed.imageId ? proposalImageUrl(proposed.imageId) : mediaPreviewUrl(proposed.mediaId!),
      crop: proposed.crop,
      ratio: proposed.width && proposed.height ? proposed.width / proposed.height : null,
    };
  }
  const own = review.animal?.photos.find((p) => p.isPrimary) ?? review.animal?.photos[0];
  return own ? { url: mediaPreviewUrl(own.assetId), crop: own.crop, ratio: null } : null;
}

/** Status wird „vermittelt“ ohne Vermittlungsjahr — annehmen geht dann nur mit dem Jahr aus dem Dialog. */
function needsYear(review: ProposalReview): boolean {
  const status = review.fields.find((f) => f.field === 'status');
  const target = status?.proposed ?? (review.proposal.kind === 'create' ? review.proposal.values?.status : undefined);
  return target === 'adopted' && review.animal?.status !== 'adopted' && typeof review.proposal.values?.adoptedYear !== 'number';
}

/**
 * Durchgehen (Spec § 6, Board 3b–3e): dieselbe Auswahl wie die Inbox, nur die offenen, als Kartenstapel. Nur mit
 * `animals.manage` und eingeschaltetem Stapel (`animals.proposals.stack`).
 */
export default async function ProposalStackPage(props: { searchParams: Promise<ProposalListQuery> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'animals.manage')) return <Page width="task"><ForbiddenCard permission="animals.manage" /></Page>;
  const q = await props.searchParams;
  const t = await getTranslations();
  const query = proposalQueryString({ ...q, state: undefined });
  const back = { href: `/animals/proposals${query ? `?${query}` : ''}`, label: t('animals.proposals.review.backToProposals') };
  // Ausgeschaltet (Vorgabe): ein alter Link führt zur Inbox mit derselben Auswahl, nicht ins Leere.
  if (readSetting<boolean>(deps, PROPOSAL_STACK_KEY) !== true) redirect(back.href);
  const list = await listProposals(deps, ctx, { ...proposalListInput(q), state: 'open' });
  const items = list.ok ? list.value.proposals : [];
  const locales = deps.locales();
  const tr = (key: string) => t(key as 'common.yes');
  const cards: StackCard[] = [];
  // Alle Karten auf einmal statt nacheinander; die Reihenfolge der Auswahl bleibt (Befund 10).
  const reviews = await Promise.all(items.map((item) => getProposal(deps, ctx, item.id)));
  for (const [i, item] of items.entries()) {
    const review = reviews[i]!;
    if (!review.ok) continue;
    const text = (field: (typeof review.value.fields)[number]['field'], value: unknown) => cut(formatProposalValue(field, value, { t: tr, locales }).map((l) => l.text).filter(Boolean).join(' / '));
    const rows = review.value.photos ?? [];
    const added = rows.filter((r) => r.change === 'new').length;
    const removed = rows.filter((r) => r.change === 'dropped').length;
    cards.push({
      id: item.id,
      kind: item.kind,
      name: item.name,
      sourceName: item.sourceName,
      createdAt: item.createdAt,
      image: imageOf(review.value),
      lines:
        item.kind === 'notice'
          ? [{ label: t('animals.proposals.kinds.notice'), from: null, to: cut(item.reason ?? '') }]
          : review.value.fields.slice(0, MAX_LINES).map((f) => ({ label: t(fieldLabelKey(f.field) as 'common.yes'), from: item.kind === 'create' ? null : text(f.field, f.current), to: text(f.field, f.proposed) })),
      photosLine: added || removed ? [added ? t('animals.proposals.stack.photosAdded', { count: added }) : '', removed ? t('animals.proposals.stack.photosRemoved', { count: removed }) : ''].filter(Boolean).join(', ') : null,
      right: rightAction(item, { needsYear: needsYear(review.value) }),
    });
  }
  return (
    <Page width="task" header={<PageHeader title={t('animals.proposals.stack.title')} back={back} />}>
      {/* Immer der Stapel, auch leer: Nach einer Entscheidung rendert der Server neu, und der Abschluss mit den Zahlen
          lebt im Stapel (er zeigt „Keine offenen Vorschläge“ nur, wenn schon beim Öffnen nichts da war). */}
      <SwipeStack cards={cards} backHref={back.href} query={query} frame={photoFrameStyle(readSetting<PhotoFrame>(deps, PHOTO_FRAME_KEY))} />
    </Page>
  );
}
