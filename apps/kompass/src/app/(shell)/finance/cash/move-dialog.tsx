'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AmountField } from '@/components/finance/amount-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { parseAmount } from '@/lib/finance/amount';
import { moveCashAction } from './actions';

export interface CashMoveAccount {
  cashId: string;
  bankAccounts: { id: string; name: string }[];
}

/** „Bargeld zur Bank gebracht / abgehoben“ (HANDOFF § 5.4, Task 2). */
export function MoveDialog({ cashId, bankAccounts, today }: { cashId: string; bankAccounts: { id: string; name: string }[]; today: string }) {
  const t = useTranslations('finance.cash.move');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<'toBank' | 'toCash'>('toBank');
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [amountText, setAmountText] = useState('');
  const [pending, setPending] = useState(false);

  const amountCents = parseAmount(amountText);

  const close = () => {
    setOpen(false);
    setDirection('toBank');
    setDate(today);
    setAmountText('');
  };

  const submit = async () => {
    if (amountCents === null || amountCents <= 0 || !bankAccountId) return;
    setPending(true);
    const result = await moveCashAction({
      fromAccountId: direction === 'toBank' ? cashId : bankAccountId,
      toAccountId: direction === 'toBank' ? bankAccountId : cashId,
      date,
      amountCents,
    });
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
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t('trigger')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="bg-surface shadow-md">
          <DialogTitle className="font-heading text-[19px]">{t('trigger')}</DialogTitle>
          <div className="space-y-4">
            <div role="group" aria-label={t('directionGroup')} className="inline-flex h-[var(--field-h)] overflow-hidden rounded-md border border-line-strong">
              {(['toBank', 'toCash'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={direction === d}
                  onClick={() => setDirection(d)}
                  className={direction === d ? 'bg-selected px-3 text-[13px] font-semibold text-selected-ink' : 'bg-surface-2 px-3 text-[13px] text-ink-2'}
                >
                  {t(`direction.${d}`)}
                </button>
              ))}
            </div>
            <label className="block space-y-1.5 text-[13px]">
              <span className="font-semibold text-ink">{t('bankAccount')}</span>
              <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1.5 text-[13px]">
              <span className="font-semibold text-ink">{t('date')}</span>
              <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="moveAmount" required>
                {t('amount')}
              </Label>
              <AmountField id="moveAmount" name="moveAmount" value={amountText} onChange={setAmountText} required />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              {t('cancel')}
            </Button>
            <Button type="button" disabled={pending || amountCents === null || amountCents <= 0 || !bankAccountId} onClick={() => void submit()}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
