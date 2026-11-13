'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { recordTaxAmendmentNoticeAction } from './actions';

/**
 * B9 (Spec 0.5.2 § 6, F6): „Anzeige eintragen …“ (Dialog `sm`) — der Tag der Anzeige an das Finanzamt zum offenen
 * Prüfanlass; ist schon einer eingetragen, ändert derselbe Dialog ihn. Das Schreiben legt die Dokumentzeile ab.
 */
export function TaxNoticeDialog({ open, onOpenChange, periodId, periodLabel, notifiedOn }: { open: boolean; onOpenChange: (open: boolean) => void; periodId: string; periodLabel: string; notifiedOn: string | null }) {
  const t = useTranslations('finance.tax.noticeDialog');
  const router = useRouter();
  const [day, setDay] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const { reset } = feedback;

  useEffect(() => {
    if (!open) return;
    setDay(notifiedOn ?? '');
    reset();
  }, [open, reset, notifiedOn]);

  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => recordTaxAmendmentNoticeAction({ taxPeriodId: periodId, notifiedOn: day }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="tax-notice-dialog">
        <DialogHeader>
          <DialogTitle>{t('title', { period: periodLabel })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="tax-notice-day" label={t('notifiedOn')} required error={errors.notifiedOn} size="s">
              <Input id="tax-notice-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </FormField>
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('save')} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['notifiedOn'])} testId="tax-notice-footer" />
      </DialogContent>
    </Dialog>
  );
}
