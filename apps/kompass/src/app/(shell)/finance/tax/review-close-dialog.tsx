'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { closeTaxAmendmentReviewAction } from './actions';

/**
 * B9 (Spec 0.5.2 § 6, F2): „Ohne Berichtigung schließen …“ (Dialog `md`) nach dem Vorbild „Wieder öffnen …“ am Zweck —
 * Pflichtbegründung, optional ein Beleg aus der Akte (nur mit `dms.view`). Die Beschreibung erklärt die Folge
 * (`tone="body"`). Über einen Agenten lehnt der Dienst ab; die Begründung steht am Zeitraum, nie im Protokoll.
 */
export function ReviewCloseDialog({ open, onOpenChange, periodId, periodLabel, canPickDocument }: { open: boolean; onOpenChange: (open: boolean) => void; periodId: string; periodLabel: string; canPickDocument: boolean }) {
  const t = useTranslations('finance.tax.closeDialog');
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const { reset } = feedback;

  useEffect(() => {
    if (!open) return;
    setReason('');
    setDocument(null);
    reset();
  }, [open, reset]);

  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => closeTaxAmendmentReviewAction({ taxPeriodId: periodId, reason: reason.trim(), ...(document ? { documentId: document.id } : {}) }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="tax-review-close-dialog">
        <DialogHeader>
          <DialogTitle>{t('title', { period: periodLabel })}</DialogTitle>
          <DialogDescription tone="body">{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="tax-review-reason" label={t('reason')} required hint={t('reasonHint')} error={errors.reason} size="full">
              <Textarea id="tax-review-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
            {canPickDocument ? <DocumentPicker id="tax-review-document" name="documentId" label={t('document')} value={document} onChange={setDocument} /> : null}
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('save')} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['reason'])} saveTestId="tax-review-close-save" testId="tax-review-close-footer" />
      </DialogContent>
    </Dialog>
  );
}
