'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { publishAnnualAccountsAction } from './actions';

type EarlyReason = 'itzDeadline' | 'funderRequest' | 'other';
const REASONS: readonly EarlyReason[] = ['itzDeadline', 'funderRequest', 'other'];
/** Ohne Grund lehnt der Dienst mit diesem Code ab; sein Satz steht am Feld „Grund“. */
const NEEDS_REASON = 'annualAccountsEarlyReasonRequired';

/**
 * „Vor der Mitgliederversammlung publizieren“ (Designer 1e, Aufbau wie 348): drei Gründe als `RadioGroup` (am Telefon
 * untereinander), bei „Sonstiges“ eine Pflichtbegründung. Der Knopf ist nie gesperrt; was fehlt, sagt der Dienst.
 */
export function PublishDialog({ open, onOpenChange, reportId, designation }: { open: boolean; onOpenChange: (open: boolean) => void; reportId: string; designation: string }) {
  const t = useTranslations('finance.reports.annualAccounts.publish');
  const router = useRouter();
  const [reason, setReason] = useState<EarlyReason | ''>('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setReason('');
    setNote('');
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const state = feedback.state;
  const needsReason = state.status === 'error' && state.code === NEEDS_REASON;
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  const reasonError = needsReason ? state.message : fieldErrors.earlyReason;

  const save = async () => {
    setPending(true);
    const trimmed = note.trim();
    const input = { reportId, ...(reason ? { earlyReason: reason } : {}), ...(reason === 'other' && trimmed ? { earlyNote: trimmed } : {}) };
    const result = await feedback.run(() => publishAnnualAccountsAction(input), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="annual-accounts-publish-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription tone="body">{t('description', { year: designation })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <div>
              <Label id="publish-reason-label" required>
                {t('reason')}
              </Label>
              <RadioGroup aria-labelledby="publish-reason-label" aria-required aria-describedby={reasonError ? 'publish-reason-error' : undefined} value={reason} onValueChange={(v) => setReason(v as EarlyReason)} className="mt-2 gap-3">
                {REASONS.map((r) => (
                  <label key={r} className="flex cursor-pointer items-start gap-2 text-body text-ink">
                    <RadioGroupItem value={r} className="mt-0.5" />
                    <span className="flex flex-col">
                      {t(`reasons.${r}.label`)}
                      {t.has(`reasons.${r}.hint`) ? <span className="text-hint text-muted-ink">{t(`reasons.${r}.hint`)}</span> : null}
                    </span>
                  </label>
                ))}
              </RadioGroup>
              <FieldError id="publish-reason-error" message={reasonError} />
            </div>
            {reason === 'other' ? (
              <FormField id="publish-note" label={t('note')} required error={fieldErrors.earlyNote} size="full">
                <Textarea id="publish-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
              </FormField>
            ) : null}
          </div>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('submit')} onSave={() => void save()} state={needsReason ? { status: 'idle' } : withUnplacedFieldErrors(state, ['earlyReason', 'earlyNote'])} />
      </DialogContent>
    </Dialog>
  );
}
