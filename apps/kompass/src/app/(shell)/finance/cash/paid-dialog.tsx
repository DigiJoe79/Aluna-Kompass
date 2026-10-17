'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ChoiceCards } from '@/components/choice-cards';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';

/**
 * „Bar bezahlt“ (HANDOFF § 5.4, Task 2): fragt zuerst Kasse oder eigene
 * Tasche. Vereinskasse → die Buchungsmaske vorbelegt; eigene Tasche legt
 * nichts an — nur ein Hinweis auf den künftigen Weg (F8a).
 */
export function PaidDialog({ cashId }: { cashId: string }) {
  const t = useTranslations('finance.cash.paid');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showPocketHint, setShowPocketHint] = useState(false);

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) setShowPocketHint(false);
  };

  return (
    <>
      {/* 07-2 B12: Die drei Kassenaktionen sind gleichrangig (`outline`). */}
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t('trigger')}
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent size="sm" className="bg-surface shadow-md">
          <DialogTitle>{t('question')}</DialogTitle>
          <div className="space-y-3">
            <ChoiceCards
              mode="action"
              legend={t('question')}
              options={[
                { value: 'cash', label: t('fromCash') },
                { value: 'pocket', label: t('fromPocket') },
              ]}
              onSelect={(value) => {
                if (value === 'cash') router.push(`/finance/entries/new?template=expense&account=${cashId}`);
                else setShowPocketHint(true);
              }}
            />
            {showPocketHint ? <Notice level="hint">{t('pocketHint')}</Notice> : null}
          </div>
          {/* 07-2 B23 (§ B): Ein Dialog ohne Hauptaktion — die Wahl ist die Handlung — behält einen Fuß mit „Abbrechen“. */}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              {tCommon('cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
