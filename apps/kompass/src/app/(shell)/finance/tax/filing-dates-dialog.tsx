'use client';

import type { TaxPeriodView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { saveTaxPeriodAction } from './actions';

/**
 * „Bearbeiten …“ im Abschnitt „Abgabe“ (Board 10b, Dialog `md`): Angefordert am, Frist*, Abgegeben am. Der Tag der
 * Abgabe geht nur mit, wenn er sich ändert — der Dienst verlangt dafür eine festgeschriebene Fassung und sagt es sonst.
 * Leer nimmt die Abgabe zurück.
 */
export function FilingDatesDialog({ open, onOpenChange, period }: { open: boolean; onOpenChange: (open: boolean) => void; period: Pick<TaxPeriodView, 'id' | 'label' | 'requestedOn' | 'dueOn' | 'filedOn' | 'version'> }) {
  const t = useTranslations('finance.tax.filing.dialog');
  const router = useRouter();
  const [requestedOn, setRequestedOn] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [filedOn, setFiledOn] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setRequestedOn(period.requestedOn ?? '');
    setDueOn(period.dueOn);
    setFiledOn(period.filedOn ?? '');
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const filedChanged = (filedOn || null) !== period.filedOn;
    const result = await feedback.run(
      () => saveTaxPeriodAction({ id: period.id, expectedVersion: period.version, requestedOn: requestedOn || null, ...(dueOn ? { dueOn } : {}), ...(filedChanged ? { filedOn: filedOn || null } : {}) }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status !== 'success') return;
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="tax-filing-dialog">
        <DialogHeader>
          <DialogTitle>{t('title', { period: period.label })}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="tax-filing-requested" label={t('requestedOn')} error={errors.requestedOn} size="s">
              <Input id="tax-filing-requested" type="date" value={requestedOn} onChange={(e) => setRequestedOn(e.target.value)} />
            </FormField>
            <FormField id="tax-filing-due" label={t('dueOn')} required error={errors.dueOn} size="s">
              <Input id="tax-filing-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
            </FormField>
            <FormField id="tax-filing-filed" label={t('filedOn')} error={errors.filedOn} size="s">
              <Input id="tax-filing-filed" type="date" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} />
            </FormField>
            <FormCell size="full" as="p" className="text-hint text-muted-ink">
              {t('filedHint')}
            </FormCell>
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('save')} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['requestedOn', 'dueOn', 'filedOn'])} testId="tax-filing-footer" />
      </DialogContent>
    </Dialog>
  );
}
