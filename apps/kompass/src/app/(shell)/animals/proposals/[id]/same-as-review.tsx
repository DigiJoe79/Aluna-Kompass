'use client';

import type { ProposalField, ProposalReview } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
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
import { Overline } from '@/components/overline';
import { SectionHeading } from '@/components/section';
import { Empty } from '@/components/empty-value';

/** Ein Wert ohne Aussage: nichts, leerer Text, leere Liste, mehrsprachig ohne Text (054). `false` und `0` sagen etwas. */
export function blankValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(blankValue);
  return false;
}

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
  // 054: Zeilen, die auf beiden Seiten leer sind, fallen weg — auch „Herkunft“, wenn der Hund keine Quelle hat.
  const rows = review.fields.filter((f) => f.field !== 'name' && !(blankValue(f.current) && blankValue(f.proposed)));
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
      {/* 054: Die Entscheidung steht in der Fußleiste der Karte wie bei Änderung und neuem Hund (051, 052). */}
      <FormCard>
        <FormCardBody>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2" data-testid="same-as-compare">
          {[
            { key: 'source', head: proposal.sourceName, name: proposed, photo: sourcePhoto ? <img src={sourcePhoto.imageId ? proposalImageUrl(sourcePhoto.imageId) : mediaPreviewUrl(sourcePhoto.mediaId!)} alt={t('photoOf', { name: proposed })} className={PHOTO} /> : null },
            { key: 'kompass', head: t('kompass'), name: animal.name, photo: ownPhoto ? <img src={mediaPreviewUrl(ownPhoto.assetId)} alt={t('photoOf', { name: animal.name })} className={PHOTO} /> : null },
          ].map((col) => ({ ...col, missing: col.key === 'source' ? t('noSourcePhoto') : t('noOwnPhoto') })).map((col) => (
            <div key={col.key} className="flex min-w-0 flex-col gap-2">
              <Overline as="span">{col.head}</Overline>
              <SectionHeading>{col.name}</SectionHeading>
              {/* Fehlt ein Foto, sagt die Fläche es (05 A4), statt grau zu bleiben. */}
              {col.photo ?? <span className={cn(PHOTO, 'flex items-center justify-center bg-surface-2 p-3 text-center text-meta text-muted-ink')}>{col.missing}</span>}
            </div>
          ))}
          {rows.map((f) => (
            <div key={f.field} className="col-span-2 grid grid-cols-2 gap-x-4 border-t border-line pt-2">
              <span className="col-span-2 text-meta font-semibold text-ink-2">{root(fieldLabelKey(f.field as ProposalField))}</span>
              {cell('p', <FieldValue field={f.field} value={f.proposed} locales={locales} />, differs(f))}
              {cell('c', <FieldValue field={f.field} value={f.current} locales={locales} />, differs(f))}
            </div>
          ))}
          {review.origins.length ? (
            <div className="col-span-2 grid grid-cols-2 gap-x-4 border-t border-line pt-2">
              <span className="col-span-2 text-meta font-semibold text-ink-2">{t('origin')}</span>
              {cell('p', <Empty />, false)}
              {cell('c', review.origins.map((o) => o.sourceName).join(', '), false)}
            </div>
          ) : null}
        </div>
          <p className="mt-4 text-meta text-ink-2">{t('explain', { proposed, name: animal.name, source: proposal.sourceName })}</p>
        </FormCardBody>
        <FormActionBar
          state={feedback.state}
          placement="page"
          mode="run"
          onSave={() => void answer('same')}
          pending={pending}
          saveLabel={t('same')}
          extraActions={<Button type="button" variant="outline" disabled={pending} onClick={() => void answer('different')}>{t('different')}</Button>}
        />
      </FormCard>
    </div>
  );
}
