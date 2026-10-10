'use client';

import type { ProposalKind } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { ActionState } from '@/lib/actions';
import { dayInZoneAfter } from '@/lib/day-store';

const FOLLOW_UP_DAYS = 14;

export interface AcceptExtra {
  publish?: boolean;
  adoptedYear?: number;
  followUp?: { dueAt: string; title: string };
}

/**
 * Annehmen mit Zusammenfassung (Board Vorschläge 6a/6b, Spec § 6): was übernommen und was behalten wird, wie die
 * Quelle es zurückbekommt; bei neuem Hund die Wahl „Auf der Webseite“ (Veröffentlichen vorgewählt, wie rechts im
 * Stapel), wird der Hund „vermittelt“ das Vermittlungsjahr, mit `followUps.manage` die Wiedervorlage (A26). Eine
 * Ablehnung hält den Dialog offen und steht über dem Fuß (MUSTER § A).
 */
export function AcceptDialog({
  open,
  onOpenChange,
  title,
  summary,
  kind,
  sourceName,
  willChange,
  askYear,
  canFollowUp,
  photoCount = 0,
  defaultYear,
  onAccept,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  summary: { taken: string[]; kept: string[]; photos: string | null };
  kind: ProposalKind;
  sourceName: string;
  willChange: boolean;
  askYear: boolean;
  canFollowUp: boolean;
  /** Neuer Hund: wie viele Fotos in die Mediathek gehen. */
  photoCount?: number;
  /** Vermittlungsjahr, das die Quelle nennt; sonst das laufende. */
  defaultYear?: number;
  onAccept: (extra: AcceptExtra) => Promise<ActionState>;
}) {
  const t = useTranslations('animals.proposals.accept');
  const c = useTranslations('common');
  const { timeZone } = useDateFormat();
  const feedback = useActionFeedback();
  const [pending, setPending] = useState(false);
  const [publish, setPublish] = useState(true);
  const [year, setYear] = useState(String(defaultYear ?? new Date().getFullYear()));
  const [followUp, setFollowUp] = useState(false);
  const [dueAt, setDueAt] = useState<string>(() => dayInZoneAfter(FOLLOW_UP_DAYS, timeZone));
  const [note, setNote] = useState('');
  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const { reset } = feedback;
  // Jedes Öffnen beginnt ohne die Ablehnung vom letzten Mal (wie `ConfirmDialog`).
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const submit = async () => {
    setPending(true);
    try {
      const extra: AcceptExtra = {
        publish: kind === 'create' ? publish : undefined,
        adoptedYear: askYear ? Number(year) : undefined,
        followUp: canFollowUp && followUp ? { dueAt, title: note } : undefined,
      };
      if (kind !== 'create') delete extra.publish;
      const result = await feedback.run(() => onAccept(extra), { retry: () => void submit() });
      if (result.status === 'success') onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  const rows = [
    { key: 'taken', label: t('taken'), value: summary.taken.join(', ') },
    { key: 'kept', label: t('kept'), value: summary.kept.join(', ') },
    { key: 'photos', label: t('photos'), value: summary.photos ?? '' },
  ].filter((r) => r.value);
  const reported = t('reported', { state: willChange ? t('stateWithChanges') : t('stateAccepted'), source: sourceName });

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) feedback.reset(); onOpenChange(next); }}>
      <DialogContent size="md" className="bg-surface shadow-md">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription tone="body">{kind === 'create' && photoCount > 0 ? `${reported} ${t('toMedia', { count: photoCount })}` : reported}</DialogDescription>
        <div className="flex flex-col gap-4">
          {rows.length > 0 ? (
            <dl className="m-0 flex flex-col gap-1.5 text-meta">
              {rows.map((r) => (
                <div key={r.key} className="flex gap-4">
                  <dt className="w-24 shrink-0 text-muted-ink">{r.label}</dt>
                  <dd className="m-0 text-ink">{r.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {kind === 'create' ? (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 text-meta font-semibold text-ink-2">{t('website')}</legend>
              <RadioGroup aria-label={t('website')} value={publish ? 'publish' : 'keep'} onValueChange={(v) => setPublish(v === 'publish')}>
                <label className="flex items-start gap-2">
                  <RadioGroupItem value="publish" className="mt-0.5" />
                  <span className="flex flex-col"><span className="text-body text-ink">{t('publish')}</span><span className="text-meta text-ink-2">{t('publishHint')}</span></span>
                </label>
                <label className="flex items-start gap-2">
                  <RadioGroupItem value="keep" className="mt-0.5" />
                  <span className="flex flex-col"><span className="text-body text-ink">{t('keepUnpublished')}</span><span className="text-meta text-ink-2">{t('keepUnpublishedHint')}</span></span>
                </label>
              </RadioGroup>
            </fieldset>
          ) : null}
          {askYear || canFollowUp ? (
            <FormGrid>
              {askYear ? (
                <FormField id="accept-adopted-year" label={t('adoptedYear')} hint={t('adoptedYearHint')} error={fieldErrors.adoptedYear} size="s">
                  <Input id="accept-adopted-year" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />
                </FormField>
              ) : null}
              {canFollowUp ? (
                <FormField id="accept-follow-up" label={t('followUp')} size="full" toggle>
                  <Checkbox id="accept-follow-up" checked={followUp} onCheckedChange={(on) => setFollowUp(on === true)} />
                </FormField>
              ) : null}
              {canFollowUp && followUp ? (
                <>
                  <FormField id="accept-follow-up-date" label={t('followUpDate')} error={fieldErrors['followUp.dueAt'] ?? fieldErrors.dueAt} size="s">
                    <Input id="accept-follow-up-date" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                  </FormField>
                  <FormField id="accept-follow-up-note" label={t('followUpNote')} error={fieldErrors['followUp.title'] ?? fieldErrors.title} size="m">
                    <Input id="accept-follow-up-note" value={note} onChange={(e) => setNote(e.target.value)} />
                  </FormField>
                </>
              ) : null}
            </FormGrid>
          ) : null}
        </div>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} onSave={() => void submit()} pending={pending} saveLabel={t('confirm')} state={feedback.state} />
      </DialogContent>
    </Dialog>
  );
}
