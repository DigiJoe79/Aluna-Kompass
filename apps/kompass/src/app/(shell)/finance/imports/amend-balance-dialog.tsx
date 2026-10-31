'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useDateFormat } from '@/components/date-format-provider';
import { AmountField } from '@/components/finance/amount-field';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { readAmount, type AmountError } from '@/lib/finance/amount';
import { formatDateOrDash } from '@/lib/finance/dates';
import { setRunClosingBalanceAction } from './actions';
import type { RunRow } from './runs-table';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';

/**
 * „Kontostand nachtragen“ (N2, Spec 6.1 „sonst fragt der Lauf optional
 * ‚Kontostand laut Bank am …?‘“): ein CSV-Lauf ohne Kontostand bekommt ihn
 * genau einmal — der Anfangssaldo entsteht daraus wie beim Import selbst.
 */
export function AmendBalanceDialog({ open, onOpenChange, run }: { open: boolean; onOpenChange: (open: boolean) => void; run: RunRow | null }) {
  const t = useTranslations('finance.imports.amendBalance');
  const { date } = useDateFormat();
  const router = useRouter();
  const [amountText, setAmountText] = useState('');
  const [pending, setPending] = useState(false);
  // 07-1 B29 (§ B): Speichern bleibt frei; ohne lesbaren Betrag steht der Fehler am Feld.
  const [amountError, setAmountError] = useState<AmountError | null>(null);
  const tAmount = useTranslations('finance.amount');
  const feedback = useActionFeedback();

  const close = () => {
    setAmountText('');
    setAmountError(null);
    feedback.reset();
    onOpenChange(false);
  };

  if (!run) return null;

  const submit = async () => {
    const balance = readAmount(amountText, { required: true });
    setAmountError(balance.ok ? null : balance.error);
    if (!balance.ok || balance.cents === null) return;
    const closingBalanceCents = balance.cents;
    setPending(true);
    const result = await feedback.run(() => setRunClosingBalanceAction(run.id, closingBalanceCents), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') {
      close();
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent size="sm" className="bg-surface shadow-md">
        <DialogTitle>{t('title')}</DialogTitle>
        <FormGrid>
          <FormField id="amendBalanceAmount" label={run.periodTo ? t('label', { date: formatDateOrDash(date, run.periodTo) }) : t('labelNoDate')} required size="s" error={amountError ? tAmount(amountError) : undefined}>
            <AmountField id="amendBalanceAmount" name="amendBalanceAmount" value={amountText} onChange={(next) => { setAmountText(next); setAmountError(null); }} allowNegative required />
          </FormField>
        </FormGrid>
        <FormActionBar placement="dialog" cancel={close} pending={pending} saveLabel={t('submit')} onSave={() => void submit()} state={feedback.state} />
      </DialogContent>
    </Dialog>
  );
}
