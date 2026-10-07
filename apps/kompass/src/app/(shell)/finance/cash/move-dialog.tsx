'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { AmountField } from '@/components/finance/amount-field';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
  const feedback = useActionFeedback();

  const amountCents = parseAmount(amountText);

  const close = () => {
    setOpen(false);
    setDirection('toBank');
    setDate(today);
    setAmountText('');
    feedback.reset();
  };

  const submit = async () => {
    if (amountCents === null || amountCents <= 0 || !bankAccountId) return;
    setPending(true);
    const result = await feedback.run(
      () =>
        moveCashAction({
          fromAccountId: direction === 'toBank' ? cashId : bankAccountId,
          toAccountId: direction === 'toBank' ? bankAccountId : cashId,
          date,
          amountCents,
        }),
      { retry: () => void submit() },
    );
    setPending(false);
    if (result.status === 'success') {
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
        <DialogContent size="sm" className="bg-surface shadow-md">
          <DialogTitle>{t('trigger')}</DialogTitle>
          <FormGrid>
            <FormCell size="m">
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
            </FormCell>
            <FormField id="moveBankAccount" label={t('bankAccount')}>
              <Select id="moveBankAccount" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="moveDate" label={t('date')} size="s">
              <Input id="moveDate" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
            </FormField>
            <FormField id="moveAmount" label={t('amount')} required size="s">
              <AmountField id="moveAmount" name="moveAmount" value={amountText} onChange={setAmountText} required />
            </FormField>
          </FormGrid>
          <FormActionBar placement="dialog" cancel={close} pending={pending} saveDisabled={amountCents === null || amountCents <= 0 || !bankAccountId} saveLabel={t('submit')} onSave={() => void submit()} state={feedback.state} />
        </DialogContent>
      </Dialog>
    </>
  );
}
