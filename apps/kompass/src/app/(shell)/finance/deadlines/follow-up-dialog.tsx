'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { createFollowUpAction } from './actions';

export interface FollowUpPreset {
  title?: string;
  dueAt?: string;
  /** Vorbelegtes Geschäftsjahr als Bezug. */
  fiscalYearId?: string;
  /** Fester Bezug statt der Jahreswahl (Bescheid: „Kopie des Bescheids der Bank vorlegen“). */
  target?: { entityType: string; entityId: string; label: string };
}

/**
 * „Wiedervorlage anlegen“ (Board 6a, Dialog `md`): Titel*, Fällig am*, Bezug (Geschäftsjahr, Vorgabe das laufende).
 * Vorbelegt aus einem Vorschlag (Jahresabschluss vor der MV, Bescheid gespeichert) — der Mensch legt an, nie Kompass.
 */
export function FollowUpDialog({ open, onOpenChange, years, defaultYearId, preset = {} }: { open: boolean; onOpenChange: (open: boolean) => void; years: readonly { id: string; designation: string }[]; defaultYearId: string | null; preset?: FollowUpPreset }) {
  const t = useTranslations('finance.deadlines.followUpDialog');
  const router = useRouter();
  const [title, setTitle] = useState(preset.title ?? '');
  const [dueAt, setDueAt] = useState(preset.dueAt ?? '');
  const [yearId, setYearId] = useState(preset.fiscalYearId ?? defaultYearId ?? years[0]?.id ?? '');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setTitle(preset.title ?? '');
    setDueAt(preset.dueAt ?? '');
    setYearId(preset.fiscalYearId ?? defaultYearId ?? years[0]?.id ?? '');
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const target = preset.target ?? { entityType: 'financeFiscalYear', entityId: yearId };
    const result = await feedback.run(() => createFollowUpAction({ entityType: target.entityType, entityId: target.entityId, title, dueAt }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(t('done'));
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="follow-up-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="follow-up-title" label={t('name')} required error={fieldErrors.title} size="full">
              <Input id="follow-up-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            </FormField>
            <FormField id="follow-up-due" label={t('dueOn')} required error={fieldErrors.dueAt} size="s">
              <Input id="follow-up-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </FormField>
            {preset.target ? (
              <FixedValue id="follow-up-subject" label={t('subject')} value={preset.target.label} reason={t('subjectFixed')} size="m" />
            ) : (
              <FormField id="follow-up-year" label={t('subject')} size="m">
                <Select id="follow-up-year" value={yearId} onChange={(e) => setYearId(e.target.value)}>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>
                      {t('subjectYear', { designation: y.designation })}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="create" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('save')} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['title', 'dueAt'])} testId="follow-up-footer" />
      </DialogContent>
    </Dialog>
  );
}
