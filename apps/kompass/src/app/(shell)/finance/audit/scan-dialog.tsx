'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { fileScanAction, fileScanFromDocumentAction } from './actions';

/**
 * „Scan ablegen …“ (Board 12e, Dialog `md`): Datei hochladen **oder** Dokument aus der Akte; bei getrennten Berichten
 * zuerst, wessen Bericht. Ohne Bericht (nur Papier-Prüfer) legt der Dienst den Vordruck-Bericht an.
 */
export function ScanDialog({
  open,
  onOpenChange,
  target,
  auditors,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { reportId: string } | { fiscalYearId: string };
  /** Nur bei getrennten Berichten: die Prüfer, deren Scan noch fehlt. */
  auditors: { id: string; name: string }[];
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations('finance.audit.scanDialog');
  const router = useRouter();
  const [auditorId, setAuditorId] = useState('');
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const upload = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setAuditorId('');
    setDocument(null);
    feedback.reset();
    upload.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const done = () => {
    toast.success(t('done'));
    onOpenChange(false);
    router.refresh();
  };
  const uploadScan = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setPending(true);
    const formData = new FormData();
    if ('reportId' in target) formData.append('reportId', target.reportId);
    else formData.append('fiscalYearId', target.fiscalYearId);
    if (auditorId) formData.append('auditorId', auditorId);
    formData.append('file', file);
    const result = await upload.run(() => fileScanAction(formData), { retry: () => void uploadScan(files) });
    setPending(false);
    if (result.status === 'success') done();
  };
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => fileScanFromDocumentAction({ ...target, ...(auditorId ? { auditorId } : {}), documentId: document?.id ?? '' }), { retry: () => void save() });
    setPending(false);
    if (result.status === 'success') done();
  };
  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" finalFocus={finalFocus} data-testid="scan-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            {auditors.length > 0 ? (
              <FormGrid>
                <FormField id="scan-auditor" label={t('auditor')} required size="m" error={fieldErrors.auditorId}>
                  <Select id="scan-auditor" value={auditorId} onChange={(e) => setAuditorId(e.target.value)}>
                    <option value="">{t('auditorPick')}</option>
                    {auditors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </FormGrid>
            ) : null}
            <div className="flex flex-col gap-2">
              <DocumentPicker id="scan-document" name="documentId" label={t('document')} value={document} onChange={setDocument} />
              <FieldError id="scan-document-error" message={fieldErrors.documentId} />
              <ReceiptDrop onFiles={(files) => void uploadScan(files)} disabled={pending} />
              <p className="text-hint text-muted-ink">{t('uploadHint')}</p>
              <RefusalNotice state={upload.state} />
            </div>
          </div>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('save')} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['auditorId', 'documentId'])} testId="scan-footer" />
      </DialogContent>
    </Dialog>
  );
}
