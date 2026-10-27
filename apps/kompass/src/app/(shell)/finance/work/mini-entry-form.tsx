'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRef } from 'react';
import { withContactReverseCharge } from '@/lib/finance/entry-form';
import { checkReverseChargeAction, contactReverseChargeAction, declineReverseChargeAction, saveContactTaxDetailsAction } from '../tax/actions';
import { ReverseChargePrompt } from '@/components/finance/reverse-charge-prompt';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { applyReverseChargeYes, reverseChargeCheckInput, reverseChargeTriggerText } from '@/lib/finance/reverse-charge-prompt';
import { useReverseChargePrompt, type ReverseChargeActions } from '@/lib/finance/use-reverse-charge-check';
import { BalanceIndicator } from '@/components/finance/balance-indicator';
import { SplitRow } from '@/components/finance/split-row';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { splitEvenly } from '@/lib/finance/split';
import { miniFormRemainder, type MiniFormRow, type MiniFormState } from '@/lib/finance/work';
import type { WorkFormOptions } from './work-detail';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';

const REVERSE_CHARGE_ACTIONS: ReverseChargeActions = { check: checkReverseChargeAction, decline: declineReverseChargeAction, mark: saveContactTaxDetailsAction };
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
  rawTransactionId,
}: {
  value: MiniFormState;
  onChange: (next: MiniFormState) => void;
  form: WorkFormOptions;
  extraLineTexts: string[];
  fieldErrors: Record<string, string>;
  /** Der Kontoumsatz: seine Gegen-IBAN zählt für die Prüffrage § 13b, wenn kein Kontakt gewählt ist. */
  rawTransactionId?: string;
}) {
  const t = useTranslations('finance.work.mini');
  const remainder = miniFormRemainder(value);
  // Die Antwort auf die Kontakt-Abfrage kommt später: Sie setzt auf den neuesten Stand, nicht den beim Klick.
  const latest = useRef(value);
  latest.current = value;
  const setRows = (rows: MiniFormRow[]) => onChange({ ...latest.current, rows });
  // Prüffrage § 13b (E6b Task 4, Board 7b A): über der schmalen Zeile, nur bei einer Ausgabe.
  const tRoot = useTranslations();
  const tPrompt = useTranslations('finance.reverseChargePrompt');
  const locale = useLocale();
  const promptInput = form.showTax && value.sign === -1 ? reverseChargeCheckInput(value.rows, { expense: true, rawTransactionId: rawTransactionId ?? null }) : null;
  const reverseCharge = useReverseChargePrompt(promptInput, REVERSE_CHARGE_ACTIONS, {
    networkMessage: tRoot('common.network'),
    onYes: (prompt) => setRows(applyReverseChargeYes(latest.current.rows, prompt)),
  });

  return (
    <section aria-label={t('label')} className="space-y-3">
      <FormGrid>
        <FormField id="work-mini-date" label={t('date')} size="s">
          <Input id="work-mini-date" type="date" value={value.entryDate} onChange={(e) => onChange({ ...value, entryDate: e.target.value })} aria-invalid={!!fieldErrors.entryDate} required />
        </FormField>
        <FormField id="work-mini-text" label={t('text')}>
          <Input id="work-mini-text" value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} aria-invalid={!!fieldErrors.text} required />
        </FormField>
      </FormGrid>

      {extraLineTexts.map((text) => (
        <p key={text} className="rounded-sm border border-line bg-surface-2 px-2.5 py-1.5 text-meta text-ink-2">
          {text}
        </p>
      ))}

      <RefusalNotice action state={reverseCharge.refusal} />
      {reverseCharge.prompt ? (
        <ReverseChargePrompt
          layout="narrow"
          trigger={reverseCharge.prompt.trigger}
          triggerText={reverseChargeTriggerText(tPrompt, reverseCharge.prompt, locale)}
          contact={reverseCharge.prompt.contact}
          pending={reverseCharge.pending}
          onYes={(o) => void reverseCharge.yes(o)}
          onNo={(reason, text) => void reverseCharge.no(reason, text)}
        />
      ) : null}

      {value.rows.map((row, index) => {
        const without = { ...value, rows: value.rows.filter((r) => r.key !== row.key) };
        const rest = miniFormRemainder(without);
        return (
          <SplitRow
            key={row.key}
            position={index + 1}
            density="narrow"
            reverseChargeAsked={reverseCharge.prompt !== null}
            value={row}
            onChange={(next) => {
              setRows(value.rows.map((r) => (r.key === row.key ? { ...r, ...next } : r)));
              // E6a Task 11c: ein Kontakt mit dem Merkmal § 13b gibt das Kennzeichen einer Ausgabezeile ohne vor —
              // wie in der Buchungsmaske. Der Umsatz sagt die Richtung (`sign`), die Kategorie geht vor.
              if (form.showTax && next.contactId && next.contactId !== row.contactId && !next.taxCode) {
                const contactId = next.contactId;
                const direction = form.categories.find((c) => c.id === next.categoryId)?.direction;
                void contactReverseChargeAction(contactId).then((reverseCharge) => {
                  if (!reverseCharge) return;
                  setRows(latest.current.rows.map((r) => (r.key === row.key && r.contactId === contactId ? withContactReverseCharge(r, direction ? direction === 'expense' : value.sign === -1, reverseCharge) : r)));
                });
              }
            }}
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
            vatContext={form.vatContext}
            entryDate={value.entryDate}
            defaultDirection={value.sign === -1 ? 'expense' : 'income'}
          />
        );
      })}

      <Button type="button" variant="outline" size="sm" onClick={() => setRows([...value.rows, emptyRow()])}>
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
