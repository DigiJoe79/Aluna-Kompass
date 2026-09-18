'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { Button } from '@/components/ui/button';
import { fileDocumentAction } from '../actions';

export function FileDialog({ documentId }: { documentId: string }) {
  const t = useTranslations('dms');
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {t('file')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('fileConfirmTitle')}
        description={t('fileConfirmDescription')}
        confirmLabel={t('fileConfirmSubmit')}
        action={() => fileDocumentAction(documentId)}
      />
    </>
  );
}
