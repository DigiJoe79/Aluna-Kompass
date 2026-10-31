'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { AmountField } from '@/components/finance/amount-field';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatEuro, readAmount, type AmountError } from '@/lib/finance/amount';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { revalueOtherAssetAction } from './actions';
import type { OtherAssetRow } from './other-asset-list';

/**
 * Der Vortag eines Tages (`YYYY-MM-DD`), kalendarisch ohne Uhr — für den Satz „der Eintrag endet am …“ (der Dienst
 * rechnet dasselbe in `dayBefore`). Ohne `Date`: Ein Client-Baustein liest nie die Browseruhr (Befund 47).
 */
function dayBefore(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  if (d > 1) return `${y}-${String(m).padStart(2, '0')}-${String(d - 1).padStart(2, '0')}`;
  const month = m === 1 ? 12 : m - 1;
  const year = m === 1 ? y - 1 : y;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const last = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return `${year}-${String(month).padStart(2, '0')}-${last}`;
}

/**
 * „Neuer Wert ab …“ (Board 11g, Dialog `sm`): Ab · Wert · Grundlage. Der alte Eintrag endet am Vortag, ein Nachfolger
 * beginnt — so bleibt jeder Stichtag richtig, ohne zu löschen.
 */
export function RevalueDialog({ entry, onClose }: { entry: OtherAssetRow; onClose: () => void }) {
  const t = useTranslations('finance.otherAssets');
  const fmt = useDateFormat();
  const router = useRouter();
  const [from, setFrom] = useState('');
  const [valueText, setValueText] = useState('');
  const [basis, setBasis] = useState('');
  const [pending, setPending] = useState(false);
  const [amountError, setAmountError] = useState<AmountError | null>(null);
  const tAmount = useTranslations('finance.amount');
  const feedback = useActionFeedback();
  useEffect(() => feedback.reset(), [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    const value = readAmount(valueText, { required: true });
    setAmountError(value.ok ? null : value.error);
    if (!value.ok) return;
    setPending(true);
    const result = await feedback.run(() => revalueOtherAssetAction({ id: entry.id, from, valueCents: value.cents, basis }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="other-asset-revalue">
        <DialogHeader>
          <DialogTitle>{t('revalue.title', { label: entry.label })}</DialogTitle>
          <DialogDescription tone="meta">{t('revalue.description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="revalue-from" label={t('revalue.from')} required error={errors.from} size="m">
              <Input id="revalue-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </FormField>
            <FormField id="revalue-value" label={t('dialog.value')} required error={amountError ? tAmount(amountError) : errors.value} size="m">
              <AmountField id="revalue-value" name="value" value={valueText} onChange={(next) => { setValueText(next); setAmountError(null); }} required />
            </FormField>
            <FormField id="revalue-basis" label={t('dialog.basis')} hint={t('dialog.basisHint')} required error={errors.basis} size="full">
              <Input id="revalue-basis" value={basis} onChange={(e) => setBasis(e.target.value)} />
            </FormField>
          </FormGrid>
          <p className="mt-3 text-meta text-muted-ink" data-testid="other-asset-revalue-before">
            {/* Ohne „Ab“ kein offener Platzhalter, mit „Ab“ das Ende am Vortag (Designer Runde 7, 253). */}
            {from ? t('revalue.beforeUntil', { value: formatEuro(entry.valueCents), since: fmt.date(entry.recordedFrom), end: fmt.date(dayBefore(from)) }) : t('revalue.before', { value: formatEuro(entry.valueCents), since: fmt.date(entry.recordedFrom) })}
          </p>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={onClose} pending={pending} saveLabel={t('revalue.save')} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['from', 'value', 'basis'])} />
      </DialogContent>
    </Dialog>
  );
}
