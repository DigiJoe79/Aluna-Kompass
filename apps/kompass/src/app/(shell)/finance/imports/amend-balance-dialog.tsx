'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useDateFormat } from '@/components/date-format-provider';
import { AmountField } from '@/components/finance/amount-field';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { parseAmount } from '@/lib/finance/amount';
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
  const [missing, setMissing] = useState(false);
  const tFields = useTranslations('errors.fields');
  const feedback = useActionFeedback();

  const closingBalanceCents = parseAmount(amountText);

  const close = () => {
    setAmountText('');
    setMissing(false);
    feedback.reset();
    onOpenChange(false);
  };

  if (!run) return null;

  const submit = async () => {
    if (closingBalanceCents === null) {
      setMissing(true);
      return;
    }
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
          <FormField id="amendBalanceAmount" label={run.periodTo ? t('label', { date: formatDateOrDash(date, run.periodTo) }) : t('labelNoDate')} required size="s" error={missing ? tFields('required') : undefined}>
            <AmountField id="amendBalanceAmount" name="amendBalanceAmount" value={amountText} onChange={(next) => { setAmountText(next); setMissing(false); }} allowNegative required />
          </FormField>
        </FormGrid>
        <FormActionBar placement="dialog" cancel={close} pending={pending} saveLabel={t('submit')} onSave={() => void submit()} state={feedback.state} />
      </DialogContent>
    </Dialog>
  );
}
