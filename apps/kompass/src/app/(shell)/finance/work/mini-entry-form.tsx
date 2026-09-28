'use client';

import { useTranslations } from 'next-intl';
import { BalanceIndicator } from '@/components/finance/balance-indicator';
import { SplitRow } from '@/components/finance/split-row';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { splitEvenly } from '@/lib/finance/split';
import { miniFormRemainder, type MiniFormRow, type MiniFormState } from '@/lib/finance/work';
import type { WorkFormOptions } from './work-detail';

const newKey = (): string => `mini-${Math.random().toString(36).slice(2, 10)}`;
const emptyRow = (): MiniFormRow => ({ key: newKey(), categoryId: '', amountText: '', contactId: null, projectId: null, purposeId: null, abroad: false, addsToAssets: false });

/**
 * Die Mini-Maske der Arbeitsliste (HANDOFF § 12.5): Datum, Text, je
 * Aufteilung eine `SplitRow density="narrow"`, „Zeile hinzufügen“ und der
 * Ausgleichsanzeiger. Konto und Betrag stehen aus dem Kontoumsatz fest;
 * weitere Geldzeilen einer Umbuchung erscheinen als Satz.
 */
export function MiniEntryForm({
  value,
  onChange,
  form,
  extraLineTexts,
  fieldErrors,
}: {
  value: MiniFormState;
  onChange: (next: MiniFormState) => void;
  form: WorkFormOptions;
  extraLineTexts: string[];
  fieldErrors: Record<string, string>;
}) {
  const t = useTranslations('finance.work.mini');
  const remainder = miniFormRemainder(value);
  const setRows = (rows: MiniFormRow[]) => onChange({ ...value, rows });

  return (
    <section aria-label={t('label')} className="space-y-3">
      <div className="grid grid-cols-[auto_1fr] gap-3">
        <div className="space-y-1">
          <Label htmlFor="work-mini-date">{t('date')}</Label>
          <Input id="work-mini-date" type="date" value={value.entryDate} onChange={(e) => onChange({ ...value, entryDate: e.target.value })} aria-invalid={!!fieldErrors.entryDate} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="work-mini-text">{t('text')}</Label>
          <Input id="work-mini-text" value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} aria-invalid={!!fieldErrors.text} required />
        </div>
      </div>

      {extraLineTexts.map((text) => (
        <p key={text} className="rounded-sm border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink-2">
          {text}
        </p>
      ))}

      {value.rows.map((row) => {
        const without = { ...value, rows: value.rows.filter((r) => r.key !== row.key) };
        const rest = miniFormRemainder(without);
        return (
          <SplitRow
            key={row.key}
            density="narrow"
            value={row}
            onChange={(next) => setRows(value.rows.map((r) => (r.key === row.key ? { ...r, ...next } : r)))}
            onRemove={() => setRows(value.rows.filter((r) => r.key !== row.key))}
            onDuplicate={() => setRows([...value.rows, { ...row, key: newKey() }])}
            onRestHere={() => rest !== null && setRows(value.rows.map((r) => (r.key === row.key ? { ...r, amountText: formatAmount(rest) } : r)))}
            onSplitEvenly={(n) => {
              const [first, ...others] = splitEvenly(parseAmount(row.amountText) ?? 0, n);
              setRows([...value.rows.map((r) => (r.key === row.key ? { ...r, amountText: formatAmount(first ?? 0) } : r)), ...others.map((cents) => ({ ...row, key: newKey(), amountText: formatAmount(cents) }))]);
            }}
            restCents={rest}
            categories={form.categories}
            purposes={form.purposes}
            projects={form.projects}
            taxCodeOptions={form.taxCodeOptions}
            showTax={form.showTax}
          />
        );
      })}

      <Button type="button" variant="secondary" size="sm" onClick={() => setRows([...value.rows, emptyRow()])}>
        {t('addRow')}
      </Button>

      {remainder !== null ? (
        <div className="overflow-hidden rounded-md border border-line">
          <BalanceIndicator open={remainder} />
        </div>
      ) : null}
    </section>
  );
}
