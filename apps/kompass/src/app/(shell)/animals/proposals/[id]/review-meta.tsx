'use client';

import type { ProposalReview } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { Notice } from '@/components/notice';

const external = 'underline underline-offset-2 hover:text-link';

/**
 * Zeile unter dem Kopf der Prüfseite (Board 2a): Quelle, Eingang, Eintrag bei der Quelle, Spur, der Hund in Kompass —
 * nur vorhandene Teile. Bei entschiedenem Vorschlag darunter, wer wann entschieden hat.
 */
export function ReviewMeta({ review }: { review: ProposalReview }) {
  const t = useTranslations('animals.proposals.review');
  const s = useTranslations('animals.proposals');
  const dates = useDateFormat();
  const { proposal, animal } = review;
  const parts: ReactNode[] = [
    proposal.sourceName,
    t('received', { at: dates.dateTime(proposal.createdAt) }),
    proposal.externalUrl ? <a href={proposal.externalUrl} target="_blank" rel="noreferrer" className={external}>{t('atSource', { source: proposal.sourceName })}</a> : null,
    proposal.trailUrl ? <a href={proposal.trailUrl} target="_blank" rel="noreferrer" className={external}>{t('trail')}</a> : null,
    animal ? <Link href={`/animals/${animal.id}`} className={external}>{t('inKompass', { name: animal.name })}</Link> : null,
  ].filter(Boolean);
  const decided = proposal.state !== 'open';
  const state = proposal.kind === 'notice' && proposal.state === 'accepted' ? s('states.acknowledged') : s(`states.${proposal.state}`);
  return (
    <div className="mb-4 flex flex-col gap-3">
      <p className="text-meta text-ink-2" data-testid="proposal-meta">
        {parts.map((p, i) => (
          <Fragment key={i}>
            {i > 0 ? ' · ' : null}
            {p}
          </Fragment>
        ))}
      </p>
      {decided ? (
        <Notice level="hint" testId="proposal-decided">
          {proposal.decisionReason === 'animalDeleted'
            ? s('animalDeleted')
            : proposal.decidedByName
              ? t('decided', { state, at: dates.dateTime(proposal.decidedAt), name: proposal.decidedByName })
              : t('decidedNoName', { state, at: dates.dateTime(proposal.decidedAt) })}
          {proposal.decisionNote ? ` ${t('decidedNote', { note: proposal.decisionNote })}` : ''}
          {proposal.cleared ? ` ${t('cleared')}` : ''}
        </Notice>
      ) : null}
    </div>
  );
}
