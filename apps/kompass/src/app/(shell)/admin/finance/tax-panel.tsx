'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { FieldError } from '@/components/forms/field-error';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { AmountField } from '@/components/finance/amount-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { AgentSwitchSection, agentSwitchChange } from '../agent-switch-section';
import { applyTaxDefaultsAction, setBoardRemunerationAction, setExpenseWaiverBasisAction, setFinanceLimitsAction, setFinanceSwitchesAction } from './actions';
import { useDateFormat } from '@/components/date-format-provider';
import { Section } from '@/components/section';

export interface TaxSwitches {
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
 * Die Steuer-Schalter, die mit der Leiste des Abschnitts gelten; der Agentenschalter steht als letzter Abschnitt in
 * derselben Karte. „Umsatzsteuerlich Unternehmer?“ steht seit Plan E6a Task 11b im Reiter „Umsatzsteuer“.
 */
const TAX_SWITCH_KEYS = ['membershipFeesCertifiable', 'expenseWaiversEnabled'] as const;
type TaxSwitchKey = (typeof TAX_SWITCH_KEYS)[number];
const AGENT_KEY = 'finance.mcpHumanOnlyAllowed';

const AMOUNT_LIMIT_KEYS = ['statementSufficesBelowCents', 'cashDonationAlertCents', 'roundAmountFromCents'] as const;
const LIMIT_IDS: Record<keyof TaxLimits, string> = {
  statementSufficesBelowCents: 'tax-limit-statement-suffices',
  cashDonationAlertCents: 'tax-limit-cash-donation',
  roundAmountFromCents: 'tax-limit-round-amount',
  proofGraceDays: 'tax-limit-proof-grace-days',
};

/**
 * Eine Einstellungszeile: Frage links, Bedienelement rechts (Entscheidung zum Inventar, 05.10.2026; K9-Befund 1). Die
 * Zeilen stehen in einer Formularkarte mit Trennlinien.
 */
export function SettingRow({ htmlFor, labelId, label, hint, testId, children }: { htmlFor?: string; labelId?: string; label: string; hint?: React.ReactNode; testId?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5" data-testid={testId}>
      {hint ? (
        // Plan E6a Task 11b (Board Umsatzsteuer 1a): eine Unterzeile unter der Frage, wo die Zeile ihre Wirkung nennt.
        <div className="min-w-0">
          <Label id={labelId} htmlFor={htmlFor} className="text-body font-normal text-ink">{label}</Label>
          <div className="text-hint text-muted-ink">{hint}</div>
        </div>
      ) : (
        <Label id={labelId} htmlFor={htmlFor} className="text-body font-normal text-ink">{label}</Label>
      )}
      <div className="flex shrink-0 items-start gap-2">{children}</div>
    </div>
  );
}

/**
 * Runde 3, 172 (Joe 2026-10-17): Die drei Steuer-Schalter gelten erst mit „Speichern“ in der Leiste des Abschnitts —
 * deshalb Ja/Nein wie die Frage nach den Pauschalen, kein Schalter (der speichert sofort, Joe 05.10.2026). Die Leiste
 * ruft einen Dienst (`setFinanceSwitch`) für jeden geänderten Schalter. Plan U4 Task 1 (Nachtrag MCP-Test § 1): Der
 * Agentenschalter ist der letzte Abschnitt dieser Karte (`AgentSwitchSection`) und geht mit derselben Leiste.
 */
function SwitchesForm({ switches }: { switches: TaxSwitches }) {
  const t = useTranslations('finance.admin.tax');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const initial = Object.fromEntries(TAX_SWITCH_KEYS.map((k) => [k, switches[k]])) as Record<TaxSwitchKey, boolean>;
  const [values, setValues] = useState(initial);
  const [agent, setAgent] = useState(switches.mcpHumanOnlyAllowed);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const changedKeys = TAX_SWITCH_KEYS.filter((k) => values[k] !== initial[k]);
  const agentChanged = agent !== switches.mcpHumanOnlyAllowed;
  const entries = [...changedKeys.map((k) => ({ key: `finance.${k}`, value: values[k] })), ...(agentChanged ? [{ key: AGENT_KEY, value: agent }] : [])];
  const save = async () => {
    if (entries.length === 0) return;
    setPending(true);
    const result = await feedback.run(() => setFinanceSwitchesAction(entries));
    setPending(false);
    if (result.status === 'success') router.refresh();
  };
  return (
    <FormCard
      as="form"
      ref={form}
      data-testid="tax-switches"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void save();
      }}
      onChange={(e: React.FormEvent) => {
        const next = agentSwitchChange(e, AGENT_KEY);
        if (next !== null) setAgent(next);
      }}
    >
      <FormCardBody className="pt-2.5">
        <div className="divide-y divide-line-2 pb-2.5">
          {TAX_SWITCH_KEYS.map((key) => (
            <SettingRow key={key} labelId={`tax-switch-${key}`} label={t(key)}>
              <RadioGroup aria-labelledby={`tax-switch-${key}`} value={values[key] ? 'yes' : 'no'} disabled={pending} onValueChange={(v) => setValues((prev) => ({ ...prev, [key]: v === 'yes' }))} className="flex-row gap-4">
                {(['yes', 'no'] as const).map((option) => (
                  <label key={option} className="flex items-center gap-2 text-body text-ink">
                    <RadioGroupItem value={option} />
                    {t(`boardRemuneration.${option}`)}
                  </label>
                ))}
              </RadioGroup>
            </SettingRow>
          ))}
        </div>
        <AgentSwitchSection name={AGENT_KEY} label={t('mcpHumanOnlyAllowed')} hint={t('mcpHumanOnlyAllowedHint')} checked={switches.mcpHumanOnlyAllowed} disabled={pending} />
      </FormCardBody>
      <FormActionBar
        count={entries.length}
        pending={pending}
        saveTestId="tax-switches-save"
        state={feedback.state}
        onDiscard={() => {
          setValues(initial);
          setAgent(switches.mcpHumanOnlyAllowed);
          form.current?.reset();
          feedback.reset();
        }}
        onSave={() => void save()}
      />
    </FormCard>
  );
}

/**
 * Runde 3, 172: die vier Grenzen mit einer Leiste statt vier Knöpfen; die Leiste ruft `setFinanceLimit` für jede
 * geänderte Grenze. Unlesbare Werte meldet die Zeile am Feld, bevor etwas abgeschickt wird.
 */
function LimitsForm({ limits }: { limits: TaxLimits }) {
  const t = useTranslations('finance.admin.tax');
  const tLimits = useTranslations('finance.admin.tax.limits');
  const router = useRouter();
  const initial: Record<keyof TaxLimits, string> = {
    statementSufficesBelowCents: formatAmount(limits.statementSufficesBelowCents),
    cashDonationAlertCents: formatAmount(limits.cashDonationAlertCents),
    roundAmountFromCents: formatAmount(limits.roundAmountFromCents),
    proofGraceDays: String(limits.proofGraceDays),
  };
  const [texts, setTexts] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const parse = (key: keyof TaxLimits): number | null => {
    if (key === 'proofGraceDays') {
      const raw = texts.proofGraceDays.trim();
      const days = /^\d+$/.test(raw) ? Number(raw) : null;
      return days !== null && days <= 365 ? days : null;
    }
    const cents = parseAmount(texts[key]);
    return cents !== null && cents >= 0 ? cents : null;
  };
  const keys = Object.keys(LIMIT_IDS) as (keyof TaxLimits)[];
  const changed = keys.filter((k) => texts[k].trim() !== initial[k]);
  const invalid = (key: keyof TaxLimits) => parse(key) === null && (attempted || texts[key].trim().length > 0);
  const save = async () => {
    if (changed.some((k) => parse(k) === null)) return setAttempted(true);
    const entries = changed.map((k) => ({ key: `finance.${k}`, cents: parse(k)! })).filter((e, i) => e.cents !== limits[changed[i]!]);
    if (entries.length === 0) return;
    setPending(true);
    const result = await feedback.run(() => setFinanceLimitsAction(entries));
    setPending(false);
    if (result.status === 'success') router.refresh();
  };
  return (
    <FormCard data-testid="tax-limits">
      <FormCardBody className="divide-y divide-line-2 py-2.5">
        {AMOUNT_LIMIT_KEYS.map((key) => (
          <SettingRow key={key} htmlFor={LIMIT_IDS[key]} label={t(`limits.${key}`)} testId={LIMIT_IDS[key]}>
            <div className="w-32">
              <AmountField id={LIMIT_IDS[key]} name={LIMIT_IDS[key]} value={texts[key]} onChange={(v) => setTexts((prev) => ({ ...prev, [key]: v }))} invalid={invalid(key)} disabled={pending} />
            </div>
          </SettingRow>
        ))}
        <SettingRow htmlFor={LIMIT_IDS.proofGraceDays} label={t('limits.proofGraceDays')} testId={LIMIT_IDS.proofGraceDays}>
          <div className="w-32">
            {/* Runde 3, 172: „Tage“ steht im Feld (`Input unit`), wie „€“ bei den Beträgen. */}
            <Input id={LIMIT_IDS.proofGraceDays} name={LIMIT_IDS.proofGraceDays} type="number" min={0} max={365} step={1} unit={tLimits('days')} value={texts.proofGraceDays} disabled={pending} aria-invalid={invalid('proofGraceDays') || undefined} aria-describedby={invalid('proofGraceDays') ? `${LIMIT_IDS.proofGraceDays}-error` : undefined} onChange={(e) => setTexts((prev) => ({ ...prev, proofGraceDays: e.target.value }))} />
            <FieldError id={`${LIMIT_IDS.proofGraceDays}-error`} message={invalid('proofGraceDays') ? tLimits('daysFormat') : undefined} />
          </div>
        </SettingRow>
      </FormCardBody>
      <FormActionBar
        count={changed.length}
        pending={pending}
        saveTestId="tax-limits-save"
        state={feedback.state}
        onDiscard={() => {
          setTexts(initial);
          setAttempted(false);
          feedback.reset();
        }}
        onSave={() => void save()}
      />
    </FormCard>
  );
}

/**
 * Die Anspruchsgrundlage des Vereins für Aufwandsspenden (Checklisten-Schritt `waiverBasis`, F8a) — nur, solange
 * Aufwandsspenden eingeschaltet sind. Ein Vertrag oder die Satzung; ein Beschluss ohne Satzungsermächtigung reicht
 * nicht. Befund J: Mit Text gehört ein Datum dazu — das meldet der Dienst am Feld „Gilt ab“. Runde 3, 172: ein eigener
 * Abschnitt mit eigener Leiste (eigener Dienst), nicht mehr ein Knopf zwischen den Schaltern.
 */
function WaiverBasisForm({ text, agreedOn }: { text: string; agreedOn: string | null }) {
  const t = useTranslations('finance.admin.tax');
  const router = useRouter();
  const [value, setValue] = useState(text);
  const [date, setDate] = useState(agreedOn ?? '');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const changed = (value.trim() !== text.trim() ? 1 : 0) + (date !== (agreedOn ?? '') ? 1 : 0);
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => setExpenseWaiverBasisAction(value, date === '' ? null : date));
    setPending(false);
    if (result.status === 'success') router.refresh();
  };
  return (
    <FormCard data-testid="waiver-basis">
      <FormCardBody>
        <FormGrid>
          <FormField id="tax-waiver-basis" label={t('waiverBasis.label')} hint={t('waiverBasis.hint')} error={errors.text} size="l">
            <Textarea id="tax-waiver-basis" rows={2} maxLength={500} value={value} disabled={pending} onChange={(e) => setValue(e.target.value)} />
          </FormField>
          <FormField id="tax-waiver-basis-agreed-on" label={t('waiverBasis.agreedOnLabel')} hint={t('waiverBasis.agreedOnHint')} error={errors.agreedOn} size="s">
            <Input id="tax-waiver-basis-agreed-on" type="date" value={date} disabled={pending} onChange={(e) => setDate(e.target.value)} />
          </FormField>
        </FormGrid>
      </FormCardBody>
      <FormActionBar
        count={changed}
        pending={pending}
        saveTestId="waiver-basis-save"
        state={withUnplacedFieldErrors(feedback.state, ['text', 'agreedOn'])}
        onDiscard={() => {
          setValue(text);
          setDate(agreedOn ?? '');
          feedback.reset();
        }}
        onSave={() => void save()}
      />
    </FormCard>
  );
}

/** Die Frage steht als Beschriftung der Einstellungszeile; die Ja/Nein-Gruppe heißt nach ihr. */
const BOARD_QUESTION_ID = 'tax-board-remuneration-question';

export interface BoardRemunerationState {
  allowed: boolean;
  basisText: string;
  validFrom: string | null;
  /** Joe 11.9: Tag der Entscheidung; ohne ihn ist die Frage offen und hat keine Vorauswahl. */
  decidedOn: string | null;
}

/**
 * F8b Annahme 10: Einrichtungspunkt „Vergütung des Vorstands“ — ohne ihn warnt jede Pauschale an ein Vorstandsmitglied.
 * Joe 11.9: eine Ja/Nein-Frage statt eines Hakens, ohne Vorauswahl, solange nichts entschieden ist — „Nein“ ist eine
 * Entscheidung und erledigt den Schritt. Fundstelle und „Gilt ab“ nur bei „Ja“; ein fehlendes „Gilt ab“ meldet der
 * Dienst am Feld, der Knopf bleibt bedienbar (MUSTER § B). Eigener Abschnitt mit `FormActionBar` (K9-Befund 2/3).
 */
function BoardRemunerationForm({ allowed, basisText, validFrom, decidedOn }: BoardRemunerationState) {
  const t = useTranslations('finance.admin.tax');
  const router = useRouter();
  const initial: 'yes' | 'no' | null = decidedOn ? (allowed ? 'yes' : 'no') : null;
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(initial);
  const [text, setText] = useState(basisText);
  const [date, setDate] = useState(validFrom ?? '');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const yes = answer === 'yes';
  // Die erste Antwort ist eine Änderung; Fundstelle und Datum zählen nur, solange sie zu sehen sind.
  const changed = (answer !== initial ? 1 : 0) + (yes && text.trim() !== basisText.trim() ? 1 : 0) + (yes && date !== (validFrom ?? '') ? 1 : 0);
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    if (answer === null) return;
    setPending(true);
    const result = await feedback.run(() => setBoardRemunerationAction(yes, yes ? text : '', yes && date !== '' ? date : null));
    setPending(false);
    if (result.status === 'success') router.refresh();
  };
  return (
    <FormCard data-testid="board-remuneration">
      {/* Dieselbe Form wie die übrigen Ja/Nein-Fragen (Runde 4, 172): Frage links, Ja/Nein rechts in einer Zeile, der
          Hinweis darunter. Fundstelle und „Gilt ab“ erscheinen nur bei „Ja“. */}
      <FormCardBody className="py-2.5">
        <SettingRow labelId={BOARD_QUESTION_ID} label={t('boardRemuneration.question')}>
          <RadioGroup aria-labelledby={BOARD_QUESTION_ID} value={answer} disabled={pending} onValueChange={(value) => setAnswer(value as 'yes' | 'no')} className="flex-row gap-4">
            {(['yes', 'no'] as const).map((option) => (
              <label key={option} className="flex items-center gap-2 text-body text-ink">
                <RadioGroupItem value={option} />
                {t(`boardRemuneration.${option}`)}
              </label>
            ))}
          </RadioGroup>
        </SettingRow>
        <p className="pb-2.5 text-hint text-muted-ink">{t('boardRemuneration.hint')}</p>
        {yes ? (
          <div className="border-t border-line-2 pb-2.5 pt-4">
            <FormGrid>
              <FormField id="tax-board-remuneration-basis" label={t('boardRemuneration.basisLabel')} error={errors.basisText} size="l">
                <Textarea id="tax-board-remuneration-basis" rows={2} maxLength={500} value={text} disabled={pending} onChange={(e) => setText(e.target.value)} />
              </FormField>
              <FormField id="tax-board-remuneration-valid-from" label={t('boardRemuneration.validFromLabel')} hint={t('boardRemuneration.validFromHint')} error={errors.validFrom} size="s">
                <Input id="tax-board-remuneration-valid-from" type="date" value={date} disabled={pending} onChange={(e) => setDate(e.target.value)} />
              </FormField>
            </FormGrid>
          </div>
        ) : null}
      </FormCardBody>
      <FormActionBar
        count={changed}
        pending={pending}
        saveTestId="board-remuneration-save"
        state={withUnplacedFieldErrors(feedback.state, yes ? ['basisText', 'validFrom'] : [])}
        onDiscard={() => {
          setAnswer(initial);
          setText(basisText);
          setDate(validFrom ?? '');
          feedback.reset();
        }}
        onSave={() => void save()}
      />
    </FormCard>
  );
}

/**
 * H7 — Steuerliches. Runde 3, 172 (Joe 2026-10-17): je Abschnitt eine Speicherleiste mit einem Dienst — Schalter,
 * Anspruchsgrundlage, Pauschalen, Grenzen. Der Agentenschalter steht seit Plan U4 Task 1 als letzter Abschnitt in der
 * Karte der Schalter und gilt wie sie erst mit „Speichern“.
 */
export function TaxPanel({
  switches,
  limits,
  confirmedAt,
  waiverBasisText,
  waiverBasisAgreedOn,
  boardRemuneration,
}: {
  switches: TaxSwitches;
  limits: TaxLimits;
  confirmedAt: string | null;
  waiverBasisText: string;
  waiverBasisAgreedOn: string | null;
  boardRemuneration: BoardRemunerationState;
}) {
  const t = useTranslations('finance.admin.tax');
  const tChecklist = useTranslations('finance.admin.checklist');
  const fmt = useDateFormat();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const defaultsFb = useActionFeedback();

  // Runde 3, 172: derselbe Dienst wie „Vorgaben übernehmen“ in der Checkliste.
  const applyDefaults = async () => {
    setPending(true);
    const result = await defaultsFb.run(() => applyTaxDefaultsAction(), { retry: () => void applyDefaults() });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  // Die Formulare tragen den gespeicherten Stand im `key`: Nach dem Speichern und `router.refresh()` beginnen sie neu.
  const switchesKey = [...TAX_SWITCH_KEYS, 'mcpHumanOnlyAllowed' as const].map((k) => String(switches[k])).join('-');
  const limitsKey = Object.values(limits).join('-');

  return (
    <section data-testid="tax-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-meta text-muted-ink">{confirmedAt ? t('confirmedAt', { date: fmt.date(confirmedAt) }) : t('notConfirmed')}</p>
        {confirmedAt ? null : (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void applyDefaults()} data-testid="tax-apply-defaults">
            {tChecklist('applyTaxDefaults')}
          </Button>
        )}
      </div>
      <RefusalNotice action state={defaultsFb.state} />
      <div className="mt-5">
        <Section title={t('sections.switches')}>
          <SwitchesForm key={switchesKey} switches={switches} />
        </Section>
        {switches.expenseWaiversEnabled ? (
          <Section title={t('sections.waiverBasis')}>
            <WaiverBasisForm key={`${waiverBasisText}-${waiverBasisAgreedOn}`} text={waiverBasisText} agreedOn={waiverBasisAgreedOn} />
          </Section>
        ) : null}
        <Section title={t('sections.boardRemuneration')}>
          <BoardRemunerationForm key={`${boardRemuneration.allowed}-${boardRemuneration.basisText}-${boardRemuneration.validFrom}-${boardRemuneration.decidedOn}`} {...boardRemuneration} />
        </Section>
        <Section title={t('sections.limits')}>
          <LimitsForm key={limitsKey} limits={limits} />
        </Section>
      </div>
    </section>
  );
}
