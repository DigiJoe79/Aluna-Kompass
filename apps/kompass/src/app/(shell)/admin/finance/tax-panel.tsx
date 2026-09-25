'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AmountField } from '@/components/finance/amount-field';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { setExpenseWaiverBasisAction, setFinanceLimitAction, setFinanceSwitchAction } from './actions';

export interface TaxSwitches {
  isEntrepreneurOrHasVatId: boolean;
  membershipFeesCertifiable: boolean;
  expenseWaiversEnabled: boolean;
  mcpHumanOnlyAllowed: boolean;
}

export interface TaxLimits {
  statementSufficesBelowCents: number;
  cashDonationAlertCents: number;
  roundAmountFromCents: number;
}

function SwitchRow({ id, label, checked, onToggle, disabled }: { id: string; label: string; checked: boolean; onToggle: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3 py-2.5 text-[14px] text-ink">
      <span>{label}</span>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} className="size-5 rounded border-line" />
    </label>
  );
}

function LimitRow({ id, label, cents, onSave }: { id: string; label: string; cents: number; onSave: (cents: number) => Promise<void> }) {
  const tLimits = useTranslations('finance.admin.tax.limits');
  const [text, setText] = useState(formatAmount(cents));
  const [pending, setPending] = useState(false);
  const parsed = parseAmount(text);
  const invalid = parsed === null || parsed < 0;

  return (
    <div className="space-y-1 py-2.5" data-testid={id}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <AmountField id={id} name={id} value={text} onChange={setText} invalid={invalid && text.trim().length > 0} disabled={pending} />
        </div>
        <Button
          type="button"
          disabled={invalid || pending}
          onClick={async () => {
            setPending(true);
            await onSave(parsed!);
            setPending(false);
          }}
        >
          {tLimits('save')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Die Anspruchsgrundlage des Vereins für Aufwandsspenden (Checklisten-Schritt
 * `waiverBasis`, F8a) — nur, solange Aufwandsspenden eingeschaltet sind. Ein
 * Vertrag oder die Satzung; ein Beschluss ohne Satzungsermächtigung reicht nicht.
 */
function WaiverBasisRow({ text }: { text: string }) {
  const t = useTranslations('finance.admin.tax');
  const router = useRouter();
  const [value, setValue] = useState(text);
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-1.5 py-2.5" data-testid="waiver-basis">
      <Label htmlFor="tax-waiver-basis">{t('waiverBasis.label')}</Label>
      <Textarea id="tax-waiver-basis" rows={2} maxLength={500} value={value} disabled={pending} aria-describedby="tax-waiver-basis-hint" onChange={(e) => setValue(e.target.value)} />
      <p id="tax-waiver-basis-hint" className="text-[12px] text-muted-ink">
        {t('waiverBasis.hint')}
      </p>
      <div className="flex justify-end">
        <Button
          type="button"
          disabled={pending || value.trim() === text.trim()}
          onClick={async () => {
            setPending(true);
            const result = await setExpenseWaiverBasisAction(value);
            setPending(false);
            if (result.status === 'error') {
              toast.error(result.message);
              return;
            }
            if (result.status === 'success' && result.message) toast.success(result.message);
            router.refresh();
          }}
        >
          {t('waiverBasis.save')}
        </Button>
      </div>
    </div>
  );
}

/** H7 — Steuerliches, Grenzen und Schalter; „Darf ein Agent festschreiben?“ deutlich abgesetzt. */
export function TaxPanel({ switches, limits, confirmedAt, waiverBasisText }: { switches: TaxSwitches; limits: TaxLimits; confirmedAt: string | null; waiverBasisText: string }) {
  const t = useTranslations('finance.admin.tax');
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const toggle = async (key: keyof TaxSwitches, value: boolean) => {
    setPending(true);
    const result = await setFinanceSwitchAction(`finance.${key}`, value);
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    router.refresh();
  };

  const saveLimit = async (key: keyof TaxLimits, cents: number) => {
    const result = await setFinanceLimitAction(`finance.${key}`, cents);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success' && result.message) toast.success(result.message);
    router.refresh();
  };

  return (
    <section className="max-w-[560px] space-y-4" data-testid="tax-panel">
      <div>
        <h2 className="font-heading text-[18px] text-ink">{t('title')}</h2>
        <p className="text-[13px] text-muted-ink">{confirmedAt ? t('confirmedAt', { date: confirmedAt.slice(0, 10) }) : t('notConfirmed')}</p>
      </div>
      <div className="divide-y divide-line-2 rounded-md border border-line bg-surface px-3.5">
        <SwitchRow id="tax-entrepreneur" label={t('isEntrepreneurOrHasVatId')} checked={switches.isEntrepreneurOrHasVatId} disabled={pending} onToggle={(v) => void toggle('isEntrepreneurOrHasVatId', v)} />
        <SwitchRow id="tax-membership-fees" label={t('membershipFeesCertifiable')} checked={switches.membershipFeesCertifiable} disabled={pending} onToggle={(v) => void toggle('membershipFeesCertifiable', v)} />
        <SwitchRow id="tax-expense-waivers" label={t('expenseWaiversEnabled')} checked={switches.expenseWaiversEnabled} disabled={pending} onToggle={(v) => void toggle('expenseWaiversEnabled', v)} />
        {switches.expenseWaiversEnabled ? <WaiverBasisRow key={waiverBasisText} text={waiverBasisText} /> : null}
      </div>
      <div className="divide-y divide-line-2 rounded-md border border-line bg-surface px-3.5" data-testid="tax-limits">
        <LimitRow id="tax-limit-statement-suffices" label={t('limits.statementSufficesBelowCents')} cents={limits.statementSufficesBelowCents} onSave={(cents) => saveLimit('statementSufficesBelowCents', cents)} />
        <LimitRow id="tax-limit-cash-donation" label={t('limits.cashDonationAlertCents')} cents={limits.cashDonationAlertCents} onSave={(cents) => saveLimit('cashDonationAlertCents', cents)} />
        <LimitRow id="tax-limit-round-amount" label={t('limits.roundAmountFromCents')} cents={limits.roundAmountFromCents} onSave={(cents) => saveLimit('roundAmountFromCents', cents)} />
      </div>
      <div className="space-y-1.5 rounded-md border-t-2 border-line-strong bg-surface-2 p-3.5" data-testid="mcp-human-only-row">
        <SwitchRow id="tax-mcp-human-only" label={t('mcpHumanOnlyAllowed')} checked={switches.mcpHumanOnlyAllowed} disabled={pending} onToggle={(v) => void toggle('mcpHumanOnlyAllowed', v)} />
        <p className="text-[12px] text-muted-ink">{t('mcpHumanOnlyAllowedHint')}</p>
      </div>
    </section>
  );
}
