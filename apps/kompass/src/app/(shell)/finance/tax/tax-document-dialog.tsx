'use client';

import type { TaxPeriodDocumentSlot } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ActionState } from '@/lib/actions';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { fileTaxPeriodDocumentAction, linkTaxPeriodDocumentAction } from './actions';

/**
 * „Ablegen …“ an einem Dokument einer Abgabe (Board 10b; Muster „Scan ablegen …“, 12e, Dialog `md`): ein PDF
 * hochladen **oder** ein Dokument aus der Akte wählen. Wohin es kommt, sagen `upload` und `link` des Aufrufers —
 * Steuererklärung (`TaxDocumentDialog`) und Umsatzsteuer-Voranmeldung (Plan E9 Task 1) teilen sich den Dialog.
 */
export function FilingDocumentDialog({ open, onOpenChange, title, description, upload: uploadAction, link, canPickDocument, testId }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; upload: (formData: FormData) => Promise<ActionState>; link: (documentId: string) => Promise<ActionState>; canPickDocument: boolean; testId: string }) {
  const t = useTranslations('finance.tax.documentDialog');
  const router = useRouter();
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const upload = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setDocument(null);
    feedback.reset();
    upload.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const done = (message?: string) => {
    if (message) toast.success(message);
    onOpenChange(false);
    router.refresh();
  };
  const uploadFile = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setPending(true);
    const formData = new FormData();
    formData.append('file', file);
    const result = await upload.run(() => uploadAction(formData), { retry: () => void uploadFile(files) });
    setPending(false);
    if (result.status === 'success') done(result.message);
  };
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => link(document?.id ?? ''), { retry: () => void save() });
    setPending(false);
    if (result.status === 'success') done(result.message);
  };
  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const prefix = testId.replace(/-dialog$/, '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-2">
            {canPickDocument ? (
              <>
                <DocumentPicker id={prefix} name="documentId" label={t('document')} value={document} onChange={setDocument} />
                <FieldError id={`${prefix}-error`} message={fieldErrors.documentId} />
              </>
            ) : null}
            <ReceiptDrop onFiles={(files) => void uploadFile(files)} disabled={pending} />
            <p className="text-hint text-muted-ink">{t('uploadHint')}</p>
            <RefusalNotice state={upload.state} />
          </div>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode="run"
          cancel={() => onOpenChange(false)}
          pending={pending}
          saveDisabled={!canPickDocument}
          saveLabel={t('save')}
          onSave={() => void save()}
          state={withUnplacedFieldErrors(feedback.state, ['documentId'])}
          testId={`${prefix}-footer`}
        />
      </DialogContent>
    </Dialog>
  );
}

/** „Ablegen …“ an einem Dokument des Zeitraums der Steuererklärung: Art „Steuererklärung“ am Zeitraum und seinem letzten Geschäftsjahr. */
export function TaxDocumentDialog({ open, onOpenChange, periodId, slot, canPickDocument }: { open: boolean; onOpenChange: (open: boolean) => void; periodId: string; slot: TaxPeriodDocumentSlot; canPickDocument: boolean }) {
  const t = useTranslations('finance.tax.documentDialog');
  return (
    <FilingDocumentDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(`title.${slot}`)}
      description={t('description')}
      upload={(formData) => {
        formData.append('id', periodId);
        formData.append('slot', slot);
        return fileTaxPeriodDocumentAction(formData);
      }}
      link={(documentId) => linkTaxPeriodDocumentAction({ id: periodId, slot, documentId })}
      canPickDocument={canPickDocument}
      testId="tax-document-dialog"
    />
  );
}
