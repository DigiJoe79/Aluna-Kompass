'use client';

import type { ProposalField, ProposalReview } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { mediaPreviewUrl, proposalImageUrl } from '../../crop-frame';

/** Titelbilder quadratisch (Board 5b), am Telefon je Spalte voll, am Rechner 192 px. */
const PHOTO = 'block aspect-square w-full rounded-sm object-cover sm:w-48';
import { acceptProposalAction } from '../actions';
import { fieldLabelKey } from '../field-format';
import { FieldValue } from './review-values';
import { useDecisionDone } from './use-decision';

/**
 * Zuordnung (Spec § 6, Board 5b): zwei Spalten Quelle / Kompass, abweichende Werte gelb hinterlegt (Markierung, keine
 * Wahl). „Gleicher Hund“ verknüpft, „Anderer Hund“ ist ebenfalls eine Annahme — „Ablehnen“ gibt es hier nicht.
 */
export function SameAsReview({ review, locales, nextHref }: { review: ProposalReview; locales: string[]; nextHref: string }) {
  const t = useTranslations('animals.proposals.sameAs');
  const root = useTranslations();
  const done = useDecisionDone(nextHref);
  const feedback = useActionFeedback();
  const [pending, setPending] = useState(false);
  const { proposal } = review;
  const animal = review.animal!;
  const proposed = proposal.proposedName || animal.name;
  const sourcePhoto = review.photos?.find((p) => p.inProposal && p.proposedPrimary) ?? review.photos?.find((p) => p.inProposal) ?? null;
  const ownPhoto = animal.photos.find((p) => p.isPrimary) ?? animal.photos[0] ?? null;
  const rows = review.fields.filter((f) => f.field !== 'name');
  const answer = async (sameAsAnswer: 'same' | 'different') => {
    setPending(true);
    try {
      done(await feedback.run(() => acceptProposalAction({ id: proposal.id, sameAsAnswer }, animal.name)));
    } finally {
      setPending(false);
    }
  };
  const differs = (f: (typeof rows)[number]) => JSON.stringify(f.current ?? null) !== JSON.stringify(f.proposed ?? null);
  const cell = (key: string, content: React.ReactNode, mark: boolean) => (
    <div key={key} className={cn('min-w-0 rounded-sm px-2 py-1.5 text-body', mark && 'bg-warning-bg')}>{content}</div>
  );
  return (
    <div className="flex flex-col gap-4">
      {proposal.reason ? <Notice level="hint">{t('reason', { reason: proposal.reason })}</Notice> : null}
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2" data-testid="same-as-compare">
          {[
            { key: 'source', head: proposal.sourceName, name: proposed, photo: sourcePhoto ? <img src={sourcePhoto.imageId ? proposalImageUrl(sourcePhoto.imageId) : mediaPreviewUrl(sourcePhoto.mediaId!)} alt={t('photoOf', { name: proposed })} className={PHOTO} /> : null },
            { key: 'kompass', head: t('kompass'), name: animal.name, photo: ownPhoto ? <img src={mediaPreviewUrl(ownPhoto.assetId)} alt={t('photoOf', { name: animal.name })} className={PHOTO} /> : null },
          ].map((col) => (
            <div key={col.key} className="flex min-w-0 flex-col gap-2">
              <span className="text-hint font-semibold uppercase tracking-wide text-muted-ink">{col.head}</span>
              <span className="font-heading text-dialog-title text-ink">{col.name}</span>
              {col.photo ?? <span className={cn(PHOTO, 'bg-surface-2')} aria-hidden />}
            </div>
          ))}
          {rows.map((f) => (
            <div key={f.field} className="col-span-2 grid grid-cols-2 gap-x-4 border-t border-line pt-2">
              <span className="col-span-2 text-meta font-semibold text-ink-2">{root(fieldLabelKey(f.field as ProposalField))}</span>
              {cell('p', <FieldValue field={f.field} value={f.proposed} locales={locales} />, differs(f))}
              {cell('c', <FieldValue field={f.field} value={f.current} locales={locales} />, differs(f))}
            </div>
          ))}
          <div className="col-span-2 grid grid-cols-2 gap-x-4 border-t border-line pt-2">
            <span className="col-span-2 text-meta font-semibold text-ink-2">{t('origin')}</span>
            {cell('p', '—', false)}
            {cell('c', review.origins.length ? review.origins.map((o) => o.sourceName).join(', ') : t('none'), false)}
          </div>
        </div>
      </div>
      <p className="text-meta text-ink-2">{t('explain', { proposed, name: animal.name, source: proposal.sourceName })}</p>
      <RefusalNotice action state={feedback.state} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" disabled={pending} onClick={() => void answer('different')}>{t('different')}</Button>
        <Button type="button" disabled={pending} onClick={() => void answer('same')}>{t('same')}</Button>
      </div>
    </div>
  );
}
