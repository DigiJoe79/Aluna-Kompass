'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AmountField } from '@/components/finance/amount-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { setBoardRemunerationAction, setExpenseWaiverBasisAction, setFinanceLimitAction, setFinanceSwitchAction } from './actions';

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
  /** F7 Task 5 (Annahme 18): Tage, keine Cent — `saveLimit` prüft nur eine ganze, nicht negative Zahl. */
  proofGraceDays: number;
}

function SwitchRow({ id, label, checked, onToggle, disabled }: { id: string; label: string; checked: boolean; onToggle: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3 py-2.5 text-[14px] text-ink">
      <span>{label}</span>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} className="size-5 rounded border-line" />
    </label>
  );
}

/** F7 Task 5 (Annahme 18): eine Anzahl Tage statt eines Betrags — Muster `LimitRow`, ohne `AmountField`. */
function DaysRow({ id, label, days, onSave }: { id: string; label: string; days: number; onSave: (days: number) => Promise<void> }) {
  const tLimits = useTranslations('finance.admin.tax.limits');
  const [text, setText] = useState(String(days));
  const [pending, setPending] = useState(false);
  const parsed = /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
  const invalid = parsed === null || parsed < 0 || parsed > 365;

  return (
    <div className="space-y-1 py-2.5" data-testid={id}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-start gap-2">
        <input id={id} name={id} type="number" min={0} max={365} step={1} value={text} disabled={pending} onChange={(e) => setText(e.target.value)} className="h-9 w-24 rounded-md border border-line bg-surface px-2.5 text-[14px] text-ink" />
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
function WaiverBasisRow({ text, agreedOn }: { text: string; agreedOn: string | null }) {
  const t = useTranslations('finance.admin.tax');
  const router = useRouter();
  const [value, setValue] = useState(text);
  const [date, setDate] = useState(agreedOn ?? '');
  const [pending, setPending] = useState(false);
  // Befund J: mit Text gehört ein Datum dazu — leeren geht ohne.
  const incomplete = value.trim() !== '' && date === '';
  return (
    <div className="space-y-1.5 py-2.5" data-testid="waiver-basis">
      <Label htmlFor="tax-waiver-basis">{t('waiverBasis.label')}</Label>
      <Textarea id="tax-waiver-basis" rows={2} maxLength={500} value={value} disabled={pending} aria-describedby="tax-waiver-basis-hint" onChange={(e) => setValue(e.target.value)} />
      <p id="tax-waiver-basis-hint" className="text-[12px] text-muted-ink">
        {t('waiverBasis.hint')}
      </p>
      <Label htmlFor="tax-waiver-basis-agreed-on">{t('waiverBasis.agreedOnLabel')}</Label>
      <Input id="tax-waiver-basis-agreed-on" type="date" value={date} disabled={pending} aria-describedby="tax-waiver-basis-agreed-on-hint" onChange={(e) => setDate(e.target.value)} className="max-w-[200px]" />
      <p id="tax-waiver-basis-agreed-on-hint" className="text-[12px] text-muted-ink">
        {t('waiverBasis.agreedOnHint')}
      </p>
      <div className="flex justify-end">
        <Button
          type="button"
          disabled={pending || incomplete || (value.trim() === text.trim() && date === (agreedOn ?? ''))}
          onClick={async () => {
            setPending(true);
            const result = await setExpenseWaiverBasisAction(value, date === '' ? null : date);
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

/** F8b Annahme 10: Einrichtungspunkt „Vergütung des Vorstands“ — ohne ihn warnt jede Pauschale an ein Vorstandsmitglied. */
function BoardRemunerationRow({ allowed, basisText, validFrom }: { allowed: boolean; basisText: string; validFrom: string | null }) {
  const t = useTranslations('finance.admin.tax');
  const router = useRouter();
  const [checked, setChecked] = useState(allowed);
  const [text, setText] = useState(basisText);
  const [date, setDate] = useState(validFrom ?? '');
  const [pending, setPending] = useState(false);
  const unchanged = checked === allowed && text.trim() === basisText.trim() && date === (validFrom ?? '');
  // Befund AK: eine bestätigte Grundlage gilt ab einem Tag.
  const incomplete = checked && date === '';
  return (
    <div className="space-y-1.5 py-2.5" data-testid="board-remuneration">
      <SwitchRow id="tax-board-remuneration" label={t('boardRemuneration.switch')} checked={checked} disabled={pending} onToggle={setChecked} />
      <Label htmlFor="tax-board-remuneration-basis">{t('boardRemuneration.basisLabel')}</Label>
      <Textarea id="tax-board-remuneration-basis" rows={2} maxLength={500} value={text} disabled={pending} aria-describedby="tax-board-remuneration-hint" onChange={(e) => setText(e.target.value)} />
      <p id="tax-board-remuneration-hint" className="text-[12px] text-muted-ink">
        {t('boardRemuneration.hint')}
      </p>
      <Label htmlFor="tax-board-remuneration-valid-from">{t('boardRemuneration.validFromLabel')}</Label>
      <Input id="tax-board-remuneration-valid-from" type="date" value={date} disabled={pending} aria-describedby="tax-board-remuneration-valid-from-hint" onChange={(e) => setDate(e.target.value)} className="max-w-[200px]" />
      <p id="tax-board-remuneration-valid-from-hint" className="text-[12px] text-muted-ink">
        {t('boardRemuneration.validFromHint')}
      </p>
      <div className="flex justify-end">
        <Button
          type="button"
          disabled={pending || unchanged || incomplete}
          onClick={async () => {
            setPending(true);
            const result = await setBoardRemunerationAction(checked, text, date === '' ? null : date);
            setPending(false);
            if (result.status === 'error') {
              toast.error(result.message);
              return;
            }
            if (result.status === 'success' && result.message) toast.success(result.message);
            router.refresh();
          }}
        >
          {t('boardRemuneration.save')}
        </Button>
      </div>
    </div>
  );
}

/** H7 — Steuerliches, Grenzen und Schalter; „Darf ein Agent festschreiben?“ deutlich abgesetzt. */
export function TaxPanel({
  switches,
  limits,
  confirmedAt,
  waiverBasisText,
  waiverBasisAgreedOn,
  boardRemunerationAllowed,
  boardRemunerationBasisText,
  boardRemunerationValidFrom,
}: {
  switches: TaxSwitches;
  limits: TaxLimits;
  confirmedAt: string | null;
  waiverBasisText: string;
  waiverBasisAgreedOn: string | null;
  boardRemunerationAllowed: boolean;
  boardRemunerationBasisText: string;
  boardRemunerationValidFrom: string | null;
}) {
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
        {switches.expenseWaiversEnabled ? <WaiverBasisRow key={`${waiverBasisText}-${waiverBasisAgreedOn}`} text={waiverBasisText} agreedOn={waiverBasisAgreedOn} /> : null}
        <BoardRemunerationRow key={`${boardRemunerationAllowed}-${boardRemunerationBasisText}-${boardRemunerationValidFrom}`} allowed={boardRemunerationAllowed} basisText={boardRemunerationBasisText} validFrom={boardRemunerationValidFrom} />
      </div>
      <div className="divide-y divide-line-2 rounded-md border border-line bg-surface px-3.5" data-testid="tax-limits">
        <LimitRow id="tax-limit-statement-suffices" label={t('limits.statementSufficesBelowCents')} cents={limits.statementSufficesBelowCents} onSave={(cents) => saveLimit('statementSufficesBelowCents', cents)} />
        <LimitRow id="tax-limit-cash-donation" label={t('limits.cashDonationAlertCents')} cents={limits.cashDonationAlertCents} onSave={(cents) => saveLimit('cashDonationAlertCents', cents)} />
        <LimitRow id="tax-limit-round-amount" label={t('limits.roundAmountFromCents')} cents={limits.roundAmountFromCents} onSave={(cents) => saveLimit('roundAmountFromCents', cents)} />
        <DaysRow id="tax-limit-proof-grace-days" label={t('limits.proofGraceDays')} days={limits.proofGraceDays} onSave={(days) => saveLimit('proofGraceDays', days)} />
      </div>
      <div className="space-y-1.5 rounded-md border-t-2 border-line-strong bg-surface-2 p-3.5" data-testid="mcp-human-only-row">
        <SwitchRow id="tax-mcp-human-only" label={t('mcpHumanOnlyAllowed')} checked={switches.mcpHumanOnlyAllowed} disabled={pending} onToggle={(v) => void toggle('mcpHumanOnlyAllowed', v)} />
        <p className="text-[12px] text-muted-ink">{t('mcpHumanOnlyAllowedHint')}</p>
      </div>
    </section>
  );
}
