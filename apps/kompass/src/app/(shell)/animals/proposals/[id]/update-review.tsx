'use client';

import type { ProposalField, ProposalReview } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { ChoiceCompare, type CompareSide } from '@/components/forms/choice-compare';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { Notice } from '@/components/notice';
import { Section } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { changedPlaces, diffExcerpt, wordDiff } from '@/lib/word-diff';
import { acceptProposalAction, rejectProposalAction } from '../actions';
import { AcceptDialog } from '../accept-dialog';
import { fieldLabelKey, formatProposalValue } from '../field-format';
import { RejectDialog } from '../reject-dialog';
import { initialPhotoState, PhotoReview, photoChoices, photoChoicesDiffer, photoCounts, photosUnchanged, type PhotoState } from './photo-review';
import { FieldValue, HintLines } from './review-values';
import { setPreviewChoice } from './preview-choice';
import { useDecisionDone } from './use-decision';
import { LOCALE_CODE } from '@/components/forms/localized-field';
import { cn } from '@/lib/utils';

const LONG = 200;
const LONG_FIELDS: readonly ProposalField[] = ['summary', 'body'];

type FieldRow = ProposalReview['fields'][number];

/** Langtext: Wortunterschied je Sprache, gekürzt auf die Stellen; aufklappbar zum ganzen Text (Board 2a). */
function LongDiff({ row, locales }: { row: FieldRow; locales: readonly string[] }) {
  const t = useTranslations('animals.proposals.review');
  const [full, setFull] = useState(false);
  const cur = (row.current ?? {}) as Record<string, string>;
  const prop = (row.proposed ?? {}) as Record<string, string>;
  const parts = locales.filter((l) => l in prop).map((l) => ({ locale: l, diff: wordDiff(cur[l] ?? '', prop[l] ?? '') }));
  const places = parts.reduce((n, p) => n + changedPlaces(p.diff), 0);
  return (
    <span className="flex flex-col gap-1.5">
      {parts.map(({ locale, diff }) => (
        <span key={locale}>
          <span className={cn('mr-1.5 rounded-sm px-1.5 py-0.5 uppercase', LOCALE_CODE)}>{locale}</span>
          {(full ? diff : diffExcerpt(diff)).map((p, i) =>
            p.kind === 'gap' ? (
              <span key={i} className="text-muted-ink"> … </span>
            ) : p.kind === 'removed' ? (
              <del key={i} className="text-error line-through">{p.text}</del>
            ) : p.kind === 'added' ? (
              <ins key={i} className="text-success no-underline">{p.text}</ins>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </span>
      ))}
      <Button type="button" variant="link" size="sm" className="h-auto w-fit p-0" onClick={() => setFull(!full)}>
        {full ? t('showLess') : t('placesChanged', { count: places })}
      </Button>
    </span>
  );
}

/** Heute bei Langtext: „Unverändert · n Zeichen · zeigen“, solange heute = Stand beim Vorschlag (Board 2a). */
function LongCurrent({ row, locales, unchanged }: { row: FieldRow; locales: readonly string[]; unchanged: boolean }) {
  const t = useTranslations('animals.proposals.review');
  const [open, setOpen] = useState(!unchanged);
  const cur = (row.current ?? {}) as Record<string, string>;
  const chars = locales.reduce((n, l) => n + (cur[l]?.length ?? 0), 0);
  if (!open)
    return (
      <span className="text-ink-2">
        {t('unchanged', { count: chars })} ·{' '}
        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setOpen(true)}>
          {t('show')}
        </Button>
      </span>
    );
  return <FieldValue field={row.field} value={row.current} locales={locales} />;
}

const isLong = (row: FieldRow, locales: readonly string[]) =>
  LONG_FIELDS.includes(row.field) && locales.some((l) => [row.current, row.proposed].some((v) => ((v as Record<string, string> | null)?.[l]?.length ?? 0) > LONG));

/**
 * Prüfseite einer Änderung (Spec § 6, Board 2a/3a): je geändertem Feld eine Wahlzeile „Heute“ / „Vorschlag“,
 * Vorwahl Vorschlag, bei Konflikt Heute; Fotos mit eigener Wahl; Annehmen und Ablehnen über Dialoge.
 */
export function UpdateReview({ review, locales, nextHref, backHref, canFollowUp, maxPhotos }: { review: ProposalReview; locales: string[]; nextHref: string; backHref: string; canFollowUp: boolean; maxPhotos: number }) {
  const t = useTranslations('animals.proposals.review');
  const a = useTranslations('animals.proposals.accept');
  const ph = useTranslations('animals.proposals.photoReview');
  const root = useTranslations();
  const dates = useDateFormat();
  const { proposal, animal } = review;
  const open = proposal.state === 'open';
  const done = useDecisionDone(nextHref);
  const [choice, setChoice] = useState<Record<string, CompareSide>>(() => Object.fromEntries(review.fields.map((f) => [f.field, f.conflict ? 'current' : 'proposal'])));
  const rows = useMemo(() => review.photos ?? [], [review.photos]);
  const [photos, setPhotos] = useState<PhotoState>(() => initialPhotoState(rows));
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const label = (f: ProposalField) => root(fieldLabelKey(f));
  const conflicts = review.fields.filter((f) => f.conflict);
  const taken = review.fields.filter((f) => choice[f.field] === 'proposal');
  const kept = review.fields.filter((f) => choice[f.field] === 'current');
  const counts = photoCounts(rows, photos);
  const photoParts = review.photos ? [counts.added ? ph('added', { count: counts.added }) : '', counts.removed ? ph('removed', { count: counts.removed }) : '', counts.primaryChanges ? ph('primaryChanges') : ''].filter(Boolean) : [];
  const photosLine = photoParts.join(', ');
  const chosenPhotos = review.photos ? photoChoices(rows, photos) : undefined;
  const changesPhotos = review.photos ? photoChoicesDiffer(rows, photos) : false;
  const willChange = kept.length > 0 || changesPhotos;
  // Alles behalten und die Fotos wie heute: Annehmen änderte am Hund nichts — ein verkleidetes Ablehnen (Befund 9).
  const noEffect = !!animal && taken.length === 0 && (!review.photos || photosUnchanged(rows, photos, animal.photos));
  const statusRow = review.fields.find((f) => f.field === 'status');
  const finalStatus = statusRow && choice.status === 'proposal' ? (statusRow.proposed as string) : animal?.status;
  const askYear = finalStatus === 'adopted' && animal?.status !== 'adopted';
  const name = animal?.name ?? proposal.name;
  const valueText = (f: FieldRow) => formatProposalValue(f.field, f.proposed, { t: (k) => root(k), locales }).map((l) => l.text).filter(Boolean).join(' / ');

  // Die Vorschau im Kopf baut „Mit Wahl“ aus genau dieser Wahl (Board 7b).
  useEffect(() => setPreviewChoice(proposal.id, { fields: choice, photos: chosenPhotos }), [proposal.id, choice, photos]); // eslint-disable-line react-hooks/exhaustive-deps
  const setAll = (side: CompareSide) => setChoice(Object.fromEntries(review.fields.map((f) => [f.field, side])));
  const note = t('summary', { taken: taken.length, kept: kept.length }) + (photosLine ? ` · ${ph('line', { line: photosLine })}` : '');

  return (
    <div className="flex flex-col gap-4">
      {conflicts.length > 0 && open ? (
        <Notice level="warn" title={conflicts.length === 1 ? t('conflictTitleOne', { field: label(conflicts[0]!.field) }) : t('conflictTitleMany', { count: conflicts.length })}>
          {t('conflictText')}
        </Notice>
      ) : null}
      <FormCard>
        <FormCardBody>
          <Section
            title={t('fields')}
            intro={t('changedCount', { count: review.fields.length })}
            actions={
              open ? (
                <span className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAll('proposal')}>{t('takeAll')}</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAll('current')}>{t('keepAll')}</Button>
                </span>
              ) : undefined
            }
          >
            <div className="@container">
              <div className="hidden grid-cols-[180px_1fr_1fr] gap-2 pb-2 text-hint font-semibold uppercase tracking-wide text-muted-ink @[760px]:grid">
                <span>{t('columnField')}</span>
                <span>{t('columnCurrent')}</span>
                <span>{t('columnProposal', { source: proposal.sourceName })}</span>
              </div>
              {review.fields.map((row) => {
                const long = isLong(row, locales);
                const by = row.conflict?.changedBy;
                return (
                  <div key={row.field} data-testid={`proposal-field-${row.field}`} className="grid gap-2 border-t border-line py-3 @[760px]:grid-cols-[180px_1fr]">
                    <span className="flex flex-wrap items-center gap-2 text-meta font-semibold text-ink-2">
                      {label(row.field)}
                      {row.conflict ? <StatusBadge tone="warning">{t('conflict')}</StatusBadge> : null}
                    </span>
                    <ChoiceCompare
                      label={label(row.field)}
                      value={choice[row.field] ?? 'proposal'}
                      onValueChange={(side) => setChoice({ ...choice, [row.field]: side })}
                      labels={{ current: t('current'), proposal: t('proposal') }}
                      disabled={!open}
                      current={long ? <LongCurrent row={row} locales={locales} unchanged={JSON.stringify(row.current) === JSON.stringify(row.baseline)} /> : <FieldValue field={row.field} value={row.current} locales={locales} />}
                      proposed={long ? <LongDiff row={row} locales={locales} /> : <FieldValue field={row.field} value={row.proposed} locales={locales} />}
                      currentExtra={
                        // Spur-Zeilen ohne Kasten: Der Hinweis oben und die Marke „Konflikt“ tragen die Warnung schon (Befund 10).
                        row.conflict ? (
                          <span className="flex flex-col gap-1 text-meta text-warning" data-testid="proposal-conflict-trail">
                            <span>{by ? (by.userName ? t('changedBy', { name: by.userName, at: dates.dateTime(by.at) }) : t('changedAt', { at: dates.dateTime(by.at) })) : t('changedSince')}</span>
                            <span>
                              {t('baseline')} <s>{formatProposalValue(row.field, row.baseline, { t: (k) => root(k), locales }).map((l) => l.text).filter(Boolean).join(' / ') || '—'}</s>
                            </span>
                          </span>
                        ) : undefined
                      }
                      proposedExtra={row.hints.length ? <HintLines hints={row.hints} /> : undefined}
                    />
                  </div>
                );
              })}
              {review.generalHints.length > 0 ? (
                <div className="border-t border-line py-3">
                  <HintLines hints={review.generalHints} />
                </div>
              ) : null}
            </div>
          </Section>
          {review.photos ? (
            <Section title={ph('title')} intro={[photosLine, ph('after', { count: counts.after, max: maxPhotos })].filter(Boolean).join(' · ')}>
              <PhotoReview rows={rows} state={photos} onChange={setPhotos} sourceName={proposal.sourceName} max={maxPhotos} readOnly={!open} />
            </Section>
          ) : null}
        </FormCardBody>
        {open ? (
          <FormActionBar
            placement="page"
            mode="run"
            note={
              noEffect ? (
                <span className="flex flex-col">
                  <span>{note}</span>
                  <span data-testid="proposal-no-effect">{t('noEffect')}</span>
                </span>
              ) : (
                note
              )
            }
            saveDisabled={noEffect}
            back={{ href: backHref, label: t('backToList') }}
            extraActions={
              <Button type="button" variant="secondary" onClick={() => setRejecting(true)}>
                {root('animals.proposals.reject.open')}
              </Button>
            }
            saveLabel={a('open')}
            onSave={() => setAccepting(true)}
          />
        ) : null}
      </FormCard>
      {open ? (
        <>
          <AcceptDialog
            open={accepting}
            onOpenChange={setAccepting}
            title={a('titleUpdate', { name })}
            summary={{
              taken: taken.map((f) => (f.field === 'status' ? `${label(f.field)} (${valueText(f)})` : label(f.field))),
              kept: kept.map((f) => (f.conflict ? a('keptConflict', { field: label(f.field) }) : label(f.field))),
              photos: photosLine || null,
            }}
            kind="update"
            sourceName={proposal.sourceName}
            willChange={willChange}
            askYear={askYear}
            canFollowUp={canFollowUp}
            defaultYear={typeof proposal.values?.adoptedYear === 'number' ? proposal.values?.adoptedYear : undefined}
            onAccept={async (extra) => done(await acceptProposalAction({ id: proposal.id, fields: choice, photos: chosenPhotos, expectedVersion: animal?.updatedAt, ...extra }, name))}
          />
          <RejectDialog open={rejecting} onOpenChange={setRejecting} sourceName={proposal.sourceName} onReject={async (reason) => done(await rejectProposalAction(proposal.id, reason, name))} />
        </>
      ) : null}
    </div>
  );
}
