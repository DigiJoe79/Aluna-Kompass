'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { Button } from '@/components/ui/button';
import { fileDocumentAction } from '../actions';
import { NumberHint } from '../receive/number-hint';

export function FileDialog({ documentId, typeKey }: { documentId: string; typeKey: string }) {
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
      >
        {/* Die Nummer, die gezogen wird, wie in „Post ablegen“ (Runde 3, 035); erst bei offenem Dialog nachgeschlagen. */}
        {open ? <NumberHint typeKey={typeKey} on="file" /> : null}
      </ConfirmDialog>
    </>
  );
}
