'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AmountField } from '@/components/finance/amount-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { parseAmount } from '@/lib/finance/amount';
import { setRunClosingBalanceAction } from './actions';
import type { RunRow } from './runs-table';

/**
 * „Kontostand nachtragen“ (N2, Spec 6.1 „sonst fragt der Lauf optional
 * ‚Kontostand laut Bank am …?‘“): ein CSV-Lauf ohne Kontostand bekommt ihn
 * genau einmal — der Anfangssaldo entsteht daraus wie beim Import selbst.
 */
export function AmendBalanceDialog({ open, onOpenChange, run }: { open: boolean; onOpenChange: (open: boolean) => void; run: RunRow | null }) {
  const t = useTranslations('finance.imports.amendBalance');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [amountText, setAmountText] = useState('');
  const [pending, setPending] = useState(false);

  const closingBalanceCents = parseAmount(amountText);

  const close = () => {
    setAmountText('');
    onOpenChange(false);
  };

  if (!run) return null;

  const submit = async () => {
    if (closingBalanceCents === null) return;
    setPending(true);
    const result = await setRunClosingBalanceAction(run.id, closingBalanceCents);
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      close();
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="bg-surface shadow-md">
        <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
        <div className="space-y-1.5">
          <Label htmlFor="amendBalanceAmount" required>
            {run.periodTo ? t('label', { date: run.periodTo }) : t('labelNoDate')}
          </Label>
          <AmountField id="amendBalanceAmount" name="amendBalanceAmount" value={amountText} onChange={setAmountText} allowNegative required />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={pending || closingBalanceCents === null} onClick={() => void submit()}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
