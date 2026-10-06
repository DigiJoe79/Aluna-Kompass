'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { AmountField } from '@/components/finance/amount-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { withUnplacedFieldErrors } from '@/lib/feedback';
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

/**
 * Eine Einstellungszeile, die beim Umlegen sofort speichert — dafür ist der Schalter das Bedienelement. Ein Haken
 * steht für Werte, die erst mit „Speichern“ gelten (Joe, 05.10.2026; siehe `BoardRemunerationForm`).
 */
function SwitchRow({ id, label, checked, onToggle, disabled }: { id: string; label: string; checked: boolean; onToggle: (value: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <Label htmlFor={id} className="cursor-pointer text-[14px] font-normal text-ink">{label}</Label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onToggle} />
    </div>
  );
}

/**
 * K9-Befund 10: Die Einzelzeilen speichern je für sich (Entscheidung zum Inventar), ihr Knopf ist aber nie ausgegraut
 * (MUSTER § B). Ohne Änderung meldet die Zeile „Nichts geändert“ wie die `FormActionBar` — gleicher Text, gleiche Zeile
 * links neben dem Knopf, nach drei Sekunden verschwunden.
 */
function useNothingChanged(): [boolean, () => void] {
  const [nothing, setNothing] = useState(false);
  useEffect(() => {
    if (!nothing) return;
    const timer = setTimeout(() => setNothing(false), 3000);
    return () => clearTimeout(timer);
  }, [nothing]);
  return [nothing, () => setNothing(true)];
}

function NothingChanged({ show }: { show: boolean }) {
  const tCommon = useTranslations('common');
  return (
    <span aria-live="polite" className="self-center text-[13px] text-ink-2">
      {show ? tCommon('nothingChanged') : null}
    </span>
  );
}

/** F7 Task 5 (Annahme 18): eine Anzahl Tage statt eines Betrags — Muster `LimitRow`, ohne `AmountField`. */
function DaysRow({ id, label, days, onSave }: { id: string; label: string; days: number; onSave: (days: number) => Promise<void> }) {
  const tLimits = useTranslations('finance.admin.tax.limits');
  const [text, setText] = useState(String(days));
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [nothing, flagNothing] = useNothingChanged();
  const parsed = /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
  const invalid = parsed === null || parsed < 0 || parsed > 365;
  const showError = invalid && (attempted || text.trim().length > 0);

  return (
    <div className="flex items-center justify-between gap-3 py-2.5" data-testid={id}>
      <Label htmlFor={id} className="text-[14px] font-normal text-ink">{label}</Label>
      <div className="flex shrink-0 items-start gap-2">
        <NothingChanged show={nothing} />
        <div className="w-24">
          <input id={id} name={id} type="number" min={0} max={365} step={1} value={text} disabled={pending} aria-invalid={showError || undefined} aria-describedby={showError ? `${id}-error` : undefined} onChange={(e) => setText(e.target.value)} className={`h-9 w-24 rounded-md border bg-surface px-2.5 text-[14px] text-ink ${showError ? 'border-error' : 'border-line'}`} />
          <FieldError id={`${id}-error`} message={showError ? tLimits('daysFormat') : undefined} />
        </div>
        <Button
          type="button"
          disabled={pending}
          onClick={async () => {
            if (invalid || parsed === null) return setAttempted(true);
            if (parsed === days) return flagNothing();
            setPending(true);
            await onSave(parsed);
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
  const [attempted, setAttempted] = useState(false);
  const [nothing, flagNothing] = useNothingChanged();
  const parsed = parseAmount(text);
  const invalid = parsed === null || parsed < 0;

  return (
    <div className="flex items-center justify-between gap-3 py-2.5" data-testid={id}>
      <Label htmlFor={id} className="text-[14px] font-normal text-ink">{label}</Label>
      <div className="flex shrink-0 items-start gap-2">
        <NothingChanged show={nothing} />
        <div className="w-32">
          <AmountField id={id} name={id} value={text} onChange={setText} invalid={invalid && (attempted || text.trim().length > 0)} disabled={pending} />
        </div>
        <Button
          type="button"
          disabled={pending}
          onClick={async () => {
            if (invalid || parsed === null) return setAttempted(true);
            if (parsed === cents) return flagNothing();
            setPending(true);
            await onSave(parsed);
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
 * Befund J: Mit Text gehört ein Datum dazu — das meldet der Dienst am Feld „Gilt seit“; der Knopf bleibt bedienbar
 * (K9-Befund 10, MUSTER § B).
 */
function WaiverBasisRow({ text, agreedOn }: { text: string; agreedOn: string | null }) {
  const t = useTranslations('finance.admin.tax');
  const router = useRouter();
  const [value, setValue] = useState(text);
  const [date, setDate] = useState(agreedOn ?? '');
  const [pending, setPending] = useState(false);
  const [nothing, flagNothing] = useNothingChanged();
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  return (
    <div className="space-y-3 py-2.5" data-testid="waiver-basis">
      <FormGrid>
        <FormField id="tax-waiver-basis" label={t('waiverBasis.label')} hint={t('waiverBasis.hint')} error={errors.text} size="l">
          <Textarea id="tax-waiver-basis" rows={2} maxLength={500} value={value} disabled={pending} onChange={(e) => setValue(e.target.value)} />
        </FormField>
        <FormField id="tax-waiver-basis-agreed-on" label={t('waiverBasis.agreedOnLabel')} hint={t('waiverBasis.agreedOnHint')} error={errors.agreedOn} size="s">
          <Input id="tax-waiver-basis-agreed-on" type="date" value={date} disabled={pending} onChange={(e) => setDate(e.target.value)} />
        </FormField>
      </FormGrid>
      <RefusalNotice action state={withUnplacedFieldErrors(feedback.state, ['text', 'agreedOn'])} />
      <div className="flex justify-end gap-2">
        <NothingChanged show={nothing} />
        <Button
          type="button"
          disabled={pending}
          onClick={async () => {
            if (value.trim() === text.trim() && date === (agreedOn ?? '')) return flagNothing();
            setPending(true);
            const result = await feedback.run(() => setExpenseWaiverBasisAction(value, date === '' ? null : date));
            setPending(false);
            if (result.status === 'success') router.refresh();
          }}
        >
          {t('waiverBasis.save')}
        </Button>
      </div>
    </div>
  );
}

/**
 * F8b Annahme 10: Einrichtungspunkt „Vergütung des Vorstands“ — ohne ihn warnt jede Pauschale an ein Vorstandsmitglied.
 * Ein eigener Abschnitt mit `FormActionBar` (K9-Befund 2/3): Haken, Fundstelle und Datum gelten erst zusammen mit
 * „Speichern“; ein fehlendes „Gilt ab“ meldet der Dienst am Feld, der Knopf bleibt bedienbar (MUSTER § B).
 */
function BoardRemunerationForm({ allowed, basisText, validFrom }: { allowed: boolean; basisText: string; validFrom: string | null }) {
  const t = useTranslations('finance.admin.tax');
  const router = useRouter();
  const [checked, setChecked] = useState(allowed);
  const [text, setText] = useState(basisText);
  const [date, setDate] = useState(validFrom ?? '');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const changed = (checked !== allowed ? 1 : 0) + (text.trim() !== basisText.trim() ? 1 : 0) + (date !== (validFrom ?? '') ? 1 : 0);
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => setBoardRemunerationAction(checked, text, date === '' ? null : date));
    setPending(false);
    if (result.status === 'success') router.refresh();
  };
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface" data-testid="board-remuneration">
      <div className="p-5">
        <FormGrid>
          {/* Ein Haken, kein Schalter: Er gilt erst mit „Speichern“, zusammen mit Grundlage und Datum. */}
          <FormField id="tax-board-remuneration" label={t('boardRemuneration.switch')} size="full" toggle>
            <Checkbox id="tax-board-remuneration" checked={checked} disabled={pending} onCheckedChange={(value) => setChecked(value === true)} />
          </FormField>
          <FormField id="tax-board-remuneration-basis" label={t('boardRemuneration.basisLabel')} hint={t('boardRemuneration.hint')} error={errors.basisText} size="l">
            <Textarea id="tax-board-remuneration-basis" rows={2} maxLength={500} value={text} disabled={pending} onChange={(e) => setText(e.target.value)} />
          </FormField>
          <FormField id="tax-board-remuneration-valid-from" label={t('boardRemuneration.validFromLabel')} hint={t('boardRemuneration.validFromHint')} error={errors.validFrom} size="s">
            <Input id="tax-board-remuneration-valid-from" type="date" value={date} disabled={pending} onChange={(e) => setDate(e.target.value)} />
          </FormField>
        </FormGrid>
      </div>
      <FormActionBar
        count={changed}
        pending={pending}
        saveTestId="board-remuneration-save"
        state={withUnplacedFieldErrors(feedback.state, ['basisText', 'validFrom'])}
        onDiscard={() => {
          setChecked(allowed);
          setText(basisText);
          setDate(validFrom ?? '');
          feedback.reset();
        }}
        onSave={() => void save()}
      />
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
  // Schalter und Grenzen speichern je für sich; die Ablehnung steht über dem Block, dessen Knopf sie ausgelöst hat.
  const toggleFb = useActionFeedback();
  const limitFb = useActionFeedback();

  const toggle = async (key: keyof TaxSwitches, value: boolean) => {
    setPending(true);
    const result = await toggleFb.run(() => setFinanceSwitchAction(`finance.${key}`, value));
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  const saveLimit = async (key: keyof TaxLimits, cents: number) => {
    const result = await limitFb.run(() => setFinanceLimitAction(`finance.${key}`, cents));
    if (result.status === 'success') router.refresh();
  };

  return (
    <section data-testid="tax-panel">
      <p className="text-[13px] text-muted-ink">{confirmedAt ? t('confirmedAt', { date: confirmedAt.slice(0, 10) }) : t('notConfirmed')}</p>
      {/* Einstellungszeilen statt Raster (Entscheidung zum Inventar, 05.10.2026): Frage links, Bedienelement rechts,
          je Zeile eigenes Speichern. Die Kästen gehen über die volle Breite, bündig mit den Trennlinien (K9-Befund 1,
          Joe 05.10.2026: das Seitenformat stört mehr als der Weg von der Frage zum Bedienelement). */}
      <section className="mt-5">
        <h3 className="text-[15px] font-semibold">{t('sections.switches')}</h3>
        <div className="mt-3">
          <FormGrid>
            <FormCell size="full" className="space-y-3">
              <RefusalNotice action state={toggleFb.state} />
              <div className="divide-y divide-line-2 rounded-md border border-line bg-surface px-3.5">
                <SwitchRow id="tax-entrepreneur" label={t('isEntrepreneurOrHasVatId')} checked={switches.isEntrepreneurOrHasVatId} disabled={pending} onToggle={(v) => void toggle('isEntrepreneurOrHasVatId', v)} />
                <SwitchRow id="tax-membership-fees" label={t('membershipFeesCertifiable')} checked={switches.membershipFeesCertifiable} disabled={pending} onToggle={(v) => void toggle('membershipFeesCertifiable', v)} />
                <SwitchRow id="tax-expense-waivers" label={t('expenseWaiversEnabled')} checked={switches.expenseWaiversEnabled} disabled={pending} onToggle={(v) => void toggle('expenseWaiversEnabled', v)} />
                {switches.expenseWaiversEnabled ? <WaiverBasisRow key={`${waiverBasisText}-${waiverBasisAgreedOn}`} text={waiverBasisText} agreedOn={waiverBasisAgreedOn} /> : null}
              </div>
            </FormCell>
          </FormGrid>
        </div>
      </section>
      <section className="mt-5 border-t border-line pt-5">
        <h3 className="text-[15px] font-semibold">{t('sections.boardRemuneration')}</h3>
        <div className="mt-3">
          <BoardRemunerationForm key={`${boardRemunerationAllowed}-${boardRemunerationBasisText}-${boardRemunerationValidFrom}`} allowed={boardRemunerationAllowed} basisText={boardRemunerationBasisText} validFrom={boardRemunerationValidFrom} />
        </div>
      </section>
      <section className="mt-5 border-t border-line pt-5">
        <h3 className="text-[15px] font-semibold">{t('sections.limits')}</h3>
        <div className="mt-3">
          <FormGrid>
            <FormCell size="full" className="space-y-3">
              <RefusalNotice action state={limitFb.state} />
              <div className="divide-y divide-line-2 rounded-md border border-line bg-surface px-3.5" data-testid="tax-limits">
                <LimitRow id="tax-limit-statement-suffices" label={t('limits.statementSufficesBelowCents')} cents={limits.statementSufficesBelowCents} onSave={(cents) => saveLimit('statementSufficesBelowCents', cents)} />
                <LimitRow id="tax-limit-cash-donation" label={t('limits.cashDonationAlertCents')} cents={limits.cashDonationAlertCents} onSave={(cents) => saveLimit('cashDonationAlertCents', cents)} />
                <LimitRow id="tax-limit-round-amount" label={t('limits.roundAmountFromCents')} cents={limits.roundAmountFromCents} onSave={(cents) => saveLimit('roundAmountFromCents', cents)} />
                <DaysRow id="tax-limit-proof-grace-days" label={t('limits.proofGraceDays')} days={limits.proofGraceDays} onSave={(days) => saveLimit('proofGraceDays', days)} />
              </div>
            </FormCell>
          </FormGrid>
        </div>
      </section>
      <section className="mt-5 border-t border-line pt-5">
        <h3 className="text-[15px] font-semibold">{t('sections.agent')}</h3>
        <div className="mt-3">
          <FormGrid>
            <FormCell size="full" className="space-y-1.5 rounded-md border-t-2 border-line-strong bg-surface-2 p-3.5" data-testid="mcp-human-only-row">
              <SwitchRow id="tax-mcp-human-only" label={t('mcpHumanOnlyAllowed')} checked={switches.mcpHumanOnlyAllowed} disabled={pending} onToggle={(v) => void toggle('mcpHumanOnlyAllowed', v)} />
              <p className="text-[12px] text-muted-ink">{t('mcpHumanOnlyAllowedHint')}</p>
            </FormCell>
          </FormGrid>
        </div>
      </section>
    </section>
  );
}
