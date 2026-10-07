'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { replaceResolutionAction } from './actions';
import { ResolutionField } from './resolution-field';
import { DocumentLabel, type ReserveRow } from './reserve-table';

/**
 * „Beschluss ersetzen“ (Befund 40): ein anderes Protokoll aus der Akte oder
 * ein neues PDF. Das bisherige bleibt in der Akte und am Datensatz verknüpft
 * — ersetzt wird nur, welcher Beschluss als maßgeblich gilt.
 */
export function ReplaceResolutionDialog({ reserve, onClose, onSaved }: { reserve: ReserveRow; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('finance.reserves.replaceResolution');
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const submit = async () => {
    setPending(true);
    const formData = new FormData();
    formData.append('id', reserve.id);
    if (document) formData.append('documentId', document.id);
    if (file) formData.append('file', file);
    const result = await feedback.run(() => replaceResolutionAction(formData), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md" className="bg-surface shadow-md">
        <DialogTitle>{t('title', { name: reserve.name })}</DialogTitle>
        <DialogDescription tone="body">{t('hint')}</DialogDescription>
        <div className="space-y-3.5" data-testid="replace-resolution-dialog">
          <p className="text-[13px] text-ink-2">
            {t('current')} <DocumentLabel document={reserve.resolution} />
          </p>
          <ResolutionField id="replace-resolution" document={document} onDocument={setDocument} onFile={setFile} />
        </div>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!document === !file} saveLabel={t('save')} saveTestId="replace-resolution-save" onSave={() => void submit()} state={withUnplacedFieldErrors(feedback.state, [])} />
      </DialogContent>
    </Dialog>
  );
}
