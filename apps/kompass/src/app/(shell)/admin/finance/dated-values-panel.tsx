'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { DatedValueRow } from '@/components/finance/dated-value-row';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { removeDatedValueAction, setDatedValueAction } from './actions';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';

export interface DatedValueListEntry {
  key: string;
  unit: 'cents' | 'percent' | 'centsPerKm' | 'months' | 'days' | 'taxation';
  entries: { validFrom: string; value: number | string; source: 'shipped' | 'override' }[];
}

const display = (unit: DatedValueListEntry['unit'], value: number | string, t: (key: string, values?: Record<string, string | number | Date>) => string): string => {
  if (unit === 'taxation') return t(`taxation.${String(value)}`);
  if (unit === 'cents') return formatEuro(Number(value));
  if (unit === 'percent') return t('unitPercent', { value });
  if (unit === 'centsPerKm') return t('unitCentsPerKm', { value: formatEuro(Number(value)) });
  if (unit === 'months') return t('unitMonths', { value });
  return t('unitDays', { value });
};

/** H6 — je Wert eine `DatedValueRow`; Besteuerungsform als taggenaue Reihe mit Erklärsatz. */
export function DatedValuesPanel({ entries }: { entries: DatedValueListEntry[] }) {
  const t = useTranslations('finance.admin.datedValues');
  const router = useRouter();
  const [editing, setEditing] = useState<DatedValueListEntry | null>(null);
  const [pending, setPending] = useState(false);
  // „Zurücksetzen“ steht in der Zeile eines Werts: Die Ablehnung steht im Kasten des Werts, dessen Zeile gedrückt wurde.
  const revertFb = useActionFeedback();
  const [revertKey, setRevertKey] = useState<string | null>(null);

  const revert = async (key: string, validFrom: string) => {
    setPending(true);
    setRevertKey(key);
    const result = await revertFb.run(() => removeDatedValueAction(key, validFrom), { retry: () => void revert(key, validFrom) });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  return (
    <section className="space-y-4" data-testid="dated-values-panel">
      <div className="space-y-3">
        {entries.map((entry) => {
          const latest = entry.entries.at(-1)!;
          return (
            <div key={entry.key} className="rounded-md border border-line">
              <div className="flex items-center justify-between px-3 pt-2.5">
                <p className="text-[13px] font-semibold text-ink">{t(`keys.${entry.key}`)}</p>
                <Button variant="ghost" size="sm" onClick={() => setEditing(entry)} data-testid={`dated-value-edit-${entry.key}`}>
                  {t('change')}
                </Button>
              </div>
              {revertKey === entry.key ? (
                <div className="px-3 pb-2">
                  <RefusalNotice action state={revertFb.state} />
                </div>
              ) : null}
              {entry.key === 'taxation' ? <p className="px-3 pb-1 text-[12px] text-muted-ink">{t('taxationHint')}</p> : null}
              {entry.entries.map((row) => (
                <DatedValueRow
                  key={row.validFrom}
                  entry={{ validFrom: row.validFrom, display: display(entry.unit, row.value, t), source: row.source }}
                  shippedLabel={t('shipped')}
                  overrideLabel={t('override')}
                  revertLabel={t('revert')}
                  pending={pending}
                  onRevert={row.source === 'override' ? () => void revert(entry.key, row.validFrom) : undefined}
                />
              ))}
              <p className="px-3 py-1.5 text-[11px] text-muted-ink">{t('currentValue', { display: display(entry.unit, latest.value, t) })}</p>
            </div>
          );
        })}
      </div>

      {editing ? (
        <DatedValueDialog
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function DatedValueDialog({ entry, onClose, onSaved }: { entry: DatedValueListEntry; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('finance.admin.datedValues');
  const tCommon = useTranslations('common');
  const [validFrom, setValidFrom] = useState('');
  const [amountText, setAmountText] = useState('');
  const [numberValue, setNumberValue] = useState('');
  const [taxation, setTaxation] = useState<'smallBusiness' | 'regular'>('smallBusiness');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const submit = async () => {
    setPending(true);
    const value: number | string =
      entry.unit === 'taxation' ? taxation : entry.unit === 'cents' ? (parseAmount(amountText) ?? 0) : Number(numberValue);
    const result = await feedback.run(() => setDatedValueAction(entry.key, validFrom, value), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" className="bg-surface shadow-md">
        <DialogTitle>{t('changeTitle', { name: t(`keys.${entry.key}`) })}</DialogTitle>
        <FormGrid>
            <FormField id="dv-valid-from" label={t('validFrom')} required size="s">
              <Input id="dv-valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} required />
            </FormField>
            {entry.unit === 'taxation' ? (
              <FormField id="dv-taxation" label={t('title')} size="s">
                <Select id="dv-taxation" value={taxation} onChange={(e) => setTaxation(e.target.value as 'smallBusiness' | 'regular')}>
                  <option value="smallBusiness">{t('taxation.smallBusiness')}</option>
                  <option value="regular">{t('taxation.regular')}</option>
                </Select>
              </FormField>
            ) : entry.unit === 'cents' ? (
              <FormField id="dv-amount" label={t('value')} required size="s">
                <Input id="dv-amount" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder={formatAmount(0)} required />
              </FormField>
            ) : (
              <FormField id="dv-number" label={t('value')} required size="s">
                <Input id="dv-number" type="number" value={numberValue} onChange={(e) => setNumberValue(e.target.value)} required />
              </FormField>
            )}
        </FormGrid>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!validFrom} saveLabel={tCommon('save')} onSave={() => void submit()} state={feedback.state} />
      </DialogContent>
    </Dialog>
  );
}
