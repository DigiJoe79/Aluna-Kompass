'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { NoticeDialog } from './notice-dialog';

/** „Bescheid erfassen“ in der Kopfzeile — öffnet den zweistufigen Dialog. */
export function AddNoticeButton({ canPickDocument }: { canPickDocument: boolean }) {
  const t = useTranslations('finance.donations.notices');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>{t('add')}</Button>
      <NoticeDialog open={open} onOpenChange={setOpen} canPickDocument={canPickDocument} />
    </>
  );
}
