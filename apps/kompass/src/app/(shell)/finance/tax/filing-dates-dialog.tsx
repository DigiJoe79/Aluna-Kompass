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
import { saveTaxAmendmentAction, saveTaxPeriodAction } from './actions';

/** B9: das Feld „Berichtigung abgegeben am“ — eine neue Berichtigung eintragen oder den Tag der letzten ändern. */
export type AmendmentField = { mode: 'record' } | { mode: 'edit'; id: string; filedOn: string };

/**
 * „Bearbeiten …“ im Abschnitt „Abgabe“ (Board 10b, Dialog `md`): Angefordert am, Frist*, Abgegeben am. Der Tag der
 * Abgabe geht nur mit, wenn er sich ändert — der Dienst verlangt dafür eine festgeschriebene Fassung und sagt es sonst.
 * Leer nimmt die Abgabe zurück. „Abgegeben am“ bleibt der erste Tag; mit `amendment` (B9) kommt „Berichtigung
 * abgegeben am“ dazu: über „Berichtigung eintragen …“ leer für eine neue, mit einer Berichtigung deren Tag.
 */
export function FilingDatesDialog({ open, onOpenChange, period, amendment = null }: { open: boolean; onOpenChange: (open: boolean) => void; period: Pick<TaxPeriodView, 'id' | 'label' | 'requestedOn' | 'dueOn' | 'filedOn' | 'version'>; amendment?: AmendmentField | null }) {
  const t = useTranslations('finance.tax.filing.dialog');
  const router = useRouter();
  const [requestedOn, setRequestedOn] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [filedOn, setFiledOn] = useState('');
  const [amendedOn, setAmendedOn] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const amend = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setRequestedOn(period.requestedOn ?? '');
    setDueOn(period.dueOn);
    setFiledOn(period.filedOn ?? '');
    setAmendedOn(amendment?.mode === 'edit' ? amendment.filedOn : '');
    feedback.reset();
    amend.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const amendErrors = amend.state.status === 'error' ? amend.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const filedChanged = (filedOn || null) !== period.filedOn;
    const periodChanged = filedChanged || (requestedOn || null) !== period.requestedOn || dueOn !== period.dueOn;
    const amendmentChanged = amendment !== null && (amendment.mode === 'record' || (amendedOn !== '' && amendedOn !== amendment.filedOn));
    if (periodChanged || !amendmentChanged) {
      const result = await feedback.run(
        () => saveTaxPeriodAction({ id: period.id, expectedVersion: period.version, requestedOn: requestedOn || null, ...(dueOn ? { dueOn } : {}), ...(filedChanged ? { filedOn: filedOn || null } : {}) }),
        { retry: () => void save() },
      );
      if (result.status !== 'success') return setPending(false);
    }
    if (amendment && amendmentChanged) {
      const result = await amend.run(() => saveTaxAmendmentAction({ taxPeriodId: period.id, ...(amendment.mode === 'edit' ? { amendmentId: amendment.id } : {}), filedOn: amendedOn }), { retry: () => void save() });
      if (result.status !== 'success') return setPending(false);
    }
    setPending(false);
    onOpenChange(false);
    router.refresh();
  };
  const state = amend.state.status === 'error' ? withUnplacedFieldErrors(amend.state, ['filedOn']) : withUnplacedFieldErrors(feedback.state, ['requestedOn', 'dueOn', 'filedOn']);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="tax-filing-dialog">
        <DialogHeader>
          <DialogTitle>{t(amendment?.mode === 'record' ? 'titleAmendment' : 'title', { period: period.label })}</DialogTitle>
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
            {amendment ? (
              <>
                <FormField id="tax-filing-amended" label={t('amendmentOn')} required={amendment.mode === 'record'} error={amendErrors.filedOn} size="s">
                  <Input id="tax-filing-amended" type="date" value={amendedOn} onChange={(e) => setAmendedOn(e.target.value)} />
                </FormField>
                <FormCell size="full" as="p" className="text-hint text-muted-ink">
                  {t('amendmentHint')}
                </FormCell>
              </>
            ) : null}
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('save')} onSave={() => void save()} state={state} testId="tax-filing-footer" />
      </DialogContent>
    </Dialog>
  );
}
