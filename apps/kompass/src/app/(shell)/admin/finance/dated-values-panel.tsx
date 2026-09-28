'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { DatedValueRow } from '@/components/finance/dated-value-row';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { removeDatedValueAction, setDatedValueAction } from './actions';

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

  const revert = async (key: string, validFrom: string) => {
    setPending(true);
    const result = await removeDatedValueAction(key, validFrom);
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success' && result.message) toast.success(result.message);
    router.refresh();
  };

  return (
    <section className="max-w-[640px] space-y-4" data-testid="dated-values-panel">
      <h2 className="font-heading text-[18px] text-ink">{t('title')}</h2>
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
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    const value: number | string =
      entry.unit === 'taxation' ? taxation : entry.unit === 'cents' ? (parseAmount(amountText) ?? 0) : Number(numberValue);
    const result = await setDatedValueAction(entry.key, validFrom, value);
    setPending(false);
    if (result.status === 'error') {
      setError(result.message);
      toast.error(result.message);
      return;
    }
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[380px]">
        <DialogTitle className="font-heading text-[18px]">{t('changeTitle', { name: t(`keys.${entry.key}`) })}</DialogTitle>
        <div className="space-y-3.5">
          {error ? <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{error}</div> : null}
          <div className="space-y-1.5">
            <Label htmlFor="dv-valid-from" required>{t('validFrom')}</Label>
            <Input id="dv-valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} required />
          </div>
          {entry.unit === 'taxation' ? (
            <div className="space-y-1.5">
              <Label htmlFor="dv-taxation">{t('title')}</Label>
              <Select id="dv-taxation" value={taxation} onChange={(e) => setTaxation(e.target.value as 'smallBusiness' | 'regular')}>
                <option value="smallBusiness">{t('taxation.smallBusiness')}</option>
                <option value="regular">{t('taxation.regular')}</option>
              </Select>
            </div>
          ) : entry.unit === 'cents' ? (
            <div className="space-y-1.5">
              <Label htmlFor="dv-amount" required>{t('value')}</Label>
              <Input id="dv-amount" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder={formatAmount(0)} required />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="dv-number" required>{t('value')}</Label>
              <Input id="dv-number" type="number" value={numberValue} onChange={(e) => setNumberValue(e.target.value)} required />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={pending || !validFrom} onClick={() => void submit()}>
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
