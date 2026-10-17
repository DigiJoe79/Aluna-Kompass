'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { removeDatedValueAction, setDatedValueAction } from './actions';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { RowMenu } from '@/components/row-menu';

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

/** H6 — je Wert eine Gruppe in einer Tabelle, je Stichtag eine Zeile; Besteuerungsform taggenau mit Erklärsatz. */
export function DatedValuesPanel({ entries }: { entries: DatedValueListEntry[] }) {
  const t = useTranslations('finance.admin.datedValues');
  const router = useRouter();
  const fmt = useDateFormat();
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

  // 11-1 B30: eine Tabelle statt 17 Karten — je Wert eine Gruppe, je Stichtag eine Zeile; der jüngste Stichtag ist
  // der heutige Stand, ein eigenes „Aktuell: …“ wiederholte ihn nur. Die Vorgabe ist der Normalfall (keine Marke).
  return (
    <section className="space-y-4" data-testid="dated-values-panel">
      {revertKey ? <RefusalNotice action state={revertFb.state} /> : null}
      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead col="title">{t('columns.name')}</TableHead>
              <TableHead col="meta">{t('validFrom')}</TableHead>
              <TableHead col="amount" className="text-right">{t('value')}</TableHead>
              <TableHead col="status">{t('columns.source')}</TableHead>
              <TableHead col="actions" className="text-right"><span className="sr-only">{t('columns.actions')}</span></TableHead>
            </TableRow>
          </TableHeader>
          {entries.map((entry) => (
            <TableBody key={entry.key}>
              {entry.entries.map((row, index) => (
                <TableRow key={row.validFrom} data-testid="dated-value-row">
                  <TableCell col="title" className="text-ink">
                    {index === 0 ? (
                      <>
                        <span>{t(`keys.${entry.key}`)}</span>
                        {/* Unterzeile, wo der Name allein nicht sagt, worauf der Wert wirkt (Runde 3, 171: Warnmarke). */}
                        {entry.key === 'taxation' ? <span className="block text-hint text-muted-ink">{t('taxationHint')}</span> : null}
                        {entry.key === 'warnAtPercent' ? <span className="block text-hint text-muted-ink">{t('warnAtPercentHint')}</span> : null}
                      </>
                    ) : (
                      <span className="sr-only">{t(`keys.${entry.key}`)}</span>
                    )}
                  </TableCell>
                  <TableCell col="meta" className="tabular-nums text-ink-2">{fmt.date(row.validFrom)}</TableCell>
                  <TableCell col="amount" className="text-right tabular-nums text-ink">{display(entry.unit, row.value, t)}</TableCell>
                  <TableCell col="status">
                    {row.source === 'override' ? <StatusBadge tone="brand">{t('override')}</StatusBadge> : <span className="text-meta text-muted-ink">{t('shipped')}</span>}
                  </TableCell>
                  <TableCell col="actions" className="text-right">
                    <RowMenu
                      name={t(`keys.${entry.key}`)}
                      testId={index === 0 ? `dated-value-menu-${entry.key}` : undefined}
                      items={[
                        { key: 'change', label: t('change'), hidden: index !== 0, onSelect: () => setEditing(entry), testId: `dated-value-edit-${entry.key}` },
                        { key: 'revert', label: t('revert'), hidden: row.source !== 'override', onSelect: () => void revert(entry.key, row.validFrom) },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          ))}
        </Table>
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
