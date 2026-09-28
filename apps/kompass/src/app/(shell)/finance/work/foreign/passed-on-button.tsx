'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';

/**
 * „Weitergegeben“: Die Rückzahlung ist ein Kontoumsatz wie jeder andere — sie
 * wird in der Arbeitsliste mit „Gehört nicht dem Verein“ und „Rückzahlung von“
 * diesem Eingang zugeordnet. Der Dialog sagt das und führt dorthin.
 */
export function PassedOnButton({ holder, amount }: { holder: string; amount: string }) {
  const t = useTranslations('finance.work.pages.foreign');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t('passedOn')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-surface shadow-md">
          <DialogTitle className="font-heading text-[19px]">{t('passedOnTitle')}</DialogTitle>
          <DialogDescription className="text-[14px] text-ink-2">{t('passedOnText', { holder, amount })}</DialogDescription>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Link href="/finance/work" className={buttonVariants({})}>
              {t('toWork')}
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
