'use client';

import type { ProposalField, ProposalKind } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Notice } from '@/components/notice';
import { buttonVariants } from '@/components/ui/button';
import { fieldLabelKey } from './proposals/field-format';

/**
 * Band „Offener Vorschlag von {Quelle}“ am Hund (Spec § 6, Board 7a). Hinweis-Stufe: Es zwingt zu keiner Handlung
 * (MUSTER § A, kein Info-Blau); Violett steht nur an Marken.
 */
export function ProposalBand({ proposal }: { proposal: { id: string; sourceName: string; fields: readonly ProposalField[]; photoCount: number; kind: ProposalKind } }) {
  const t = useTranslations('animals.proposalBand');
  const p = useTranslations('animals.proposals');
  const root = useTranslations();
  const parts = proposal.fields.map((f) => root(fieldLabelKey(f)));
  if (proposal.photoCount > 0) parts.push(p('photos', { count: proposal.photoCount }));
  return (
    <Notice level="hint" title={t('title', { source: proposal.sourceName })} testId="animal-proposal-band">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span>{parts.join(', ') || p(`kinds.${proposal.kind}`)}</span>
        <Link href={`/animals/proposals/${proposal.id}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          {t('review')}
        </Link>
      </span>
    </Notice>
  );
}
