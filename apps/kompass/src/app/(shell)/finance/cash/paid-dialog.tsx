'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/**
 * „Bar bezahlt“ (HANDOFF § 5.4, Task 2): fragt zuerst Kasse oder eigene
 * Tasche. Vereinskasse → die Buchungsmaske vorbelegt; eigene Tasche legt
 * nichts an — nur ein Hinweis auf den künftigen Weg (F8a).
 */
export function PaidDialog({ cashId }: { cashId: string }) {
  const t = useTranslations('finance.cash.paid');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showPocketHint, setShowPocketHint] = useState(false);

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) setShowPocketHint(false);
  };

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t('trigger')}
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="bg-surface shadow-md">
          <DialogTitle className="font-heading text-[19px]">{t('question')}</DialogTitle>
          <div className="space-y-3">
            <Button type="button" className="w-full justify-start" onClick={() => router.push(`/finance/entries/new?template=expense&account=${cashId}`)}>
              {t('fromCash')}
            </Button>
            <Button type="button" variant="secondary" className="w-full justify-start" onClick={() => setShowPocketHint(true)}>
              {t('fromPocket')}
            </Button>
            {showPocketHint ? <Notice level="hint">{t('pocketHint')}</Notice> : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
