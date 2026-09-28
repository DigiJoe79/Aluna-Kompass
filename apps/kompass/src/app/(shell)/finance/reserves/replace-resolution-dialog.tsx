'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
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
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.append('id', reserve.id);
    if (document) formData.append('documentId', document.id);
    if (file) formData.append('file', file);
    const result = await replaceResolutionAction(formData);
    setPending(false);
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[480px]">
        <DialogTitle className="font-heading text-[19px]">{t('title', { name: reserve.name })}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">{t('hint')}</DialogDescription>
        <div className="space-y-3.5" data-testid="replace-resolution-dialog">
          {error ? (
            <Notice level="refuse">
              <span role="alert">{error}</span>
            </Notice>
          ) : null}
          <p className="text-[13px] text-ink-2">
            {t('current')} <DocumentLabel document={reserve.resolution} />
          </p>
          <ResolutionField id="replace-resolution" document={document} onDocument={setDocument} onFile={setFile} />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={pending || !document === !file} onClick={() => void submit()} data-testid="replace-resolution-save">
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
