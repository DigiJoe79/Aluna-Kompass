'use client';

import type { VatSettingsStand, VatSettingsView } from '@kompass/module-finance';
import { FEDERAL_STATES } from '@kompass/module-finance/vat-calendar';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { Empty } from '@/components/empty-value';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { panelHref } from '@/components/panel-nav';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { formatEuro } from '@/lib/finance/amount';
import { removeVatSettingsAction, saveVatSettingsAction } from './actions';
import { SettingRow } from './tax-panel';

type YesNo = 'yes' | 'no';
type Period = 'auto' | 'quarter' | 'month';
type Values = { entrepreneur: YesNo | null; vatId: string; advancePeriod: Period; advanceExempt: YesNo; permanentExtension: YesNo; taxOfficeState: string };

/** Die Felder, an denen der Dienst Fehler meldet und die der Reiter zeigt. */
const PLACED = ['validFrom', 'vatEntrepreneur', 'vatId', 'vatAdvancePeriod', 'vatAdvanceExempt', 'vatPermanentExtension', 'taxOfficeState'];

const yesNo = (value: boolean): YesNo => (value ? 'yes' : 'no');

/**
 * Plan E6a Task 11b — Reiter „Umsatzsteuer“ (Board Umsatzsteuer 1a, 1b): alle Werte gelten gemeinsam ab einem Tag,
 * deshalb eine Karte mit „Gilt ab“ und einer Leiste, die einen neuen Stand speichert (nur die geänderten Werte,
 * `saveVatSettings`). Darunter die früheren Stände wie H6. Den Vorschlag „Unternehmer“ macht Kompass als Hinweis über
 * der Karte; gesetzt wird nichts von selbst. Ohne `finance.setup` nur lesen.
 */
export function VatPanel({ view, today, canEdit }: { view: VatSettingsView; today: string; canEdit: boolean }) {
  const t = useTranslations('finance.admin.vat');
  const suggestion = view.hints.find((h) => h.code === 'entrepreneurSuggested');
  // Das Formular beginnt nach dem Speichern (router.refresh) mit dem neuen Stand.
  const formKey = JSON.stringify([view.profile, view.entrepreneurDecided, view.history.length]);
  return (
    <section className="space-y-5" data-testid="vat-panel">
      {suggestion && suggestion.code === 'entrepreneurSuggested' ? (
        <Notice level="hint" testId="vat-suggestion">
          {t('suggestion', { year: String(suggestion.year), names: suggestion.names.join(', '), amount: formatEuro(suggestion.incomeCents) })}
        </Notice>
      ) : null}
      <VatForm key={formKey} view={view} today={today} canEdit={canEdit} />
      {view.history.length > 0 ? (
        <Section title={t('history.title')}>
          <History stands={view.history} canEdit={canEdit} />
        </Section>
      ) : null}
    </section>
  );
}

function VatForm({ view, today, canEdit }: { view: VatSettingsView; today: string; canEdit: boolean }) {
  const t = useTranslations('finance.admin.vat');
  const tTabs = useTranslations('finance.admin.tabs');
  const fmt = useDateFormat();
  const router = useRouter();
  const p = view.profile;
  const initial: Values = {
    entrepreneur: view.entrepreneurDecided ? yesNo(p.entrepreneur) : null,
    vatId: p.vatId ?? '',
    advancePeriod: p.advancePeriod,
    advanceExempt: yesNo(p.advanceExempt),
    permanentExtension: yesNo(p.permanentExtension),
    taxOfficeState: p.taxOfficeState ?? '',
  };
  const [values, setValues] = useState<Values>(initial);
  const [validFrom, setValidFrom] = useState(today);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((prev) => ({ ...prev, [key]: value }));
  const regular = p.taxation === 'regular';
  // 1b A: Kleinunternehmer und „Nein“ — nur die Frage und ein Satz, die übrigen Zeilen fallen weg. Hat der Verein eine
  // USt-IdNr., bleibt ihr Feld: Sie verlegt den Ort von EU-Dienstleistungen an seinen Sitz (§ 3a Abs. 2 S. 3 UStG,
  // Befund 37), dann schuldet er auch dafür die Steuer.
  const onlyQuestion = values.entrepreneur === 'no' && !regular;
  const vatIdKept = onlyQuestion && initial.vatId !== '';

  const changes: Record<string, unknown> = {};
  if (values.entrepreneur !== null && values.entrepreneur !== initial.entrepreneur) changes.vatEntrepreneur = values.entrepreneur === 'yes';
  if ((!onlyQuestion || vatIdKept) && values.vatId.trim() !== initial.vatId) changes.vatId = values.vatId.trim();
  if (!onlyQuestion) {
    if (values.advancePeriod !== initial.advancePeriod) changes.vatAdvancePeriod = values.advancePeriod;
    if (regular && values.advanceExempt !== initial.advanceExempt) changes.vatAdvanceExempt = values.advanceExempt === 'yes';
    if (values.permanentExtension !== initial.permanentExtension) changes.vatPermanentExtension = values.permanentExtension === 'yes';
    if (values.taxOfficeState !== initial.taxOfficeState) changes.taxOfficeState = values.taxOfficeState;
  }
  const count = Object.keys(changes).length;

  const save = async () => {
    if (count === 0) return;
    setPending(true);
    const result = await feedback.run(() => saveVatSettingsAction({ validFrom, ...changes }), { retry: () => void save() });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  const disabled = pending || !canEdit;
  const yesNoGroup = (labelId: string, value: YesNo | null, onChange: (v: YesNo) => void, error?: string) => (
    <div>
      <RadioGroup aria-labelledby={labelId} value={value} disabled={disabled} onValueChange={(v) => onChange(v as YesNo)} className="flex-row gap-4">
        {(['yes', 'no'] as const).map((option) => (
          <label key={option} className="flex items-center gap-2 text-body text-ink">
            <RadioGroupItem value={option} />
            {t(`yesNo.${option}`)}
          </label>
        ))}
      </RadioGroup>
      <FieldError id={`${labelId}-error`} message={error} />
    </div>
  );

  const taxationName = t(`taxation.${p.taxation}`);
  const monthly = values.advancePeriod === 'month' || (values.advancePeriod === 'auto' && view.advancePeriodKind === 'month');
  const vatIdHintId = 'vat-id-hint';
  const vatIdError = errors.vatId;
  const vatIdRow = (
    <SettingRow
      htmlFor="vat-id"
      label={t('vatId.label')}
      hint={
        <span id={vatIdHintId}>
          {values.entrepreneur === 'yes' && values.vatId.trim() === '' ? <span className="block text-warning">{t('vatId.recommended')}</span> : null}
          {onlyQuestion ? <span className="block">{t('vatId.notEntrepreneur')}</span> : null}
          <span className="block">{t('vatId.hint')}</span>
        </span>
      }
    >
      <div className="w-40">
        <Input
          id="vat-id"
          className="font-mono"
          value={values.vatId}
          maxLength={20}
          disabled={disabled}
          aria-invalid={vatIdError ? true : undefined}
          aria-describedby={[vatIdHintId, vatIdError ? 'vat-id-error' : null].filter(Boolean).join(' ')}
          onChange={(e) => set('vatId', e.target.value)}
        />
        <FieldError id="vat-id-error" message={vatIdError} />
      </div>
    </SettingRow>
  );

  return (
    <FormCard
      as="form"
      data-testid="vat-settings"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void save();
      }}
    >
      {canEdit ? (
        <FormCardBody className="pb-0">
          <FormGrid>
            <FormField id="vat-valid-from" label={t('validFrom.label')} hint={t('validFrom.hint')} error={errors.validFrom} required size="s">
              <Input id="vat-valid-from" type="date" value={validFrom} disabled={pending} onChange={(e) => setValidFrom(e.target.value)} />
            </FormField>
          </FormGrid>
        </FormCardBody>
      ) : null}
      <FormCardBody className="pt-2.5">
        <div className="divide-y divide-line-2 pb-2.5">
          <SettingRow labelId="vat-entrepreneur" label={t('entrepreneur.label')}>
            {yesNoGroup('vat-entrepreneur', values.entrepreneur, (v) => set('entrepreneur', v), errors.vatEntrepreneur)}
          </SettingRow>
          {onlyQuestion ? (
            <>
              <p className="py-2.5 text-body text-ink-2" data-testid="vat-not-entrepreneur">{t('notEntrepreneur')}</p>
              {vatIdKept ? vatIdRow : null}
            </>
          ) : (
            <>
              <SettingRow
                labelId="vat-taxation"
                label={t('taxation.label')}
                hint={<Link href={panelHref('/admin/finance', 'datedValues')} className="underline underline-offset-2">{t('taxation.change', { tab: tTabs('datedValues') })}</Link>}
              >
                <span className="text-body text-ink">
                  {view.taxationSince ? t('taxation.since', { name: taxationName, date: fmt.date(view.taxationSince) }) : taxationName}
                </span>
              </SettingRow>
              {vatIdRow}
              <SettingRow labelId="vat-advance-period" label={t('advancePeriod.label')} hint={values.advancePeriod === 'auto' ? t('advancePeriod.autoHint', { kind: view.advancePeriodKind }) : undefined}>
                <div>
                  <Segmented<Period>
                    name="vat-advance-period"
                    value={values.advancePeriod}
                    disabled={disabled}
                    onValueChange={(v) => set('advancePeriod', v)}
                    options={(['auto', 'quarter', 'month'] as const).map((v) => ({ value: v, label: t(`advancePeriod.${v}`) }))}
                  />
                  <FieldError id="vat-advance-period-error" message={errors.vatAdvancePeriod} />
                </div>
              </SettingRow>
              {regular ? (
                <SettingRow labelId="vat-advance-exempt" label={t('advanceExempt.label')} hint={t('advanceExempt.hint')}>
                  {yesNoGroup('vat-advance-exempt', values.advanceExempt, (v) => set('advanceExempt', v), errors.vatAdvanceExempt)}
                </SettingRow>
              ) : null}
              <SettingRow
                labelId="vat-permanent-extension"
                label={t('permanentExtension.label')}
                hint={
                  <>
                    <span className="block">{t('permanentExtension.hint')}</span>
                    {regular && monthly && values.permanentExtension === 'yes' ? <span className="block">{t('permanentExtension.specialPrepayment')}</span> : null}
                  </>
                }
              >
                {yesNoGroup('vat-permanent-extension', values.permanentExtension, (v) => set('permanentExtension', v), errors.vatPermanentExtension)}
              </SettingRow>
              <SettingRow htmlFor="vat-tax-office-state" label={t('taxOfficeState.label')} hint={t('taxOfficeState.hint')}>
                <div className="w-56">
                  <Select id="vat-tax-office-state" value={values.taxOfficeState} disabled={disabled} onChange={(e) => set('taxOfficeState', e.target.value)}>
                    <option value="">{t('taxOfficeState.none')}</option>
                    {FEDERAL_STATES.map((state) => (
                      <option key={state} value={state}>
                        {t(`states.${state}`)}
                      </option>
                    ))}
                  </Select>
                  <FieldError id="vat-tax-office-state-error" message={errors.taxOfficeState} />
                </div>
              </SettingRow>
            </>
          )}
        </div>
      </FormCardBody>
      {canEdit ? (
        <FormActionBar
          count={count}
          pending={pending}
          saveTestId="vat-settings-save"
          state={withUnplacedFieldErrors(feedback.state, PLACED)}
          onDiscard={() => {
            setValues(initial);
            setValidFrom(today);
            feedback.reset();
          }}
          onSave={() => void save()}
        />
      ) : null}
    </FormCard>
  );
}

/**
 * Stände wie H6 (Sätze und Grenzen): je Tag eine Zeile, der geltende Stand ist dabei — daher „Stände“, nicht „Frühere
 * Stände“ (Befund 30 g). Die Werte sind die ab dem Tag geltenden (`effective`), ein nicht eingetragener also aus dem
 * Stand davor oder als Vorgabe ausgeschrieben, wie das Formular sie zeigt. ⋯ „Entfernen …“ mit Rückfrage.
 */
function History({ stands, canEdit }: { stands: VatSettingsStand[]; canEdit: boolean }) {
  const t = useTranslations('finance.admin.vat');
  const fmt = useDateFormat();
  const router = useRouter();
  const [removing, setRemoving] = useState<VatSettingsStand['removal'] | null>(null);
  const flag = (value: unknown) => (typeof value === 'boolean' ? t(`history.${value ? 'yes' : 'no'}`) : <Empty />);
  return (
    <div className="overflow-hidden rounded-md border border-line">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead col="title">{t('history.validFrom')}</TableHead>
            <TableHead col="meta">{t('history.entrepreneur')}</TableHead>
            <TableHead col="meta">{t('history.vatId')}</TableHead>
            <TableHead col="meta">{t('history.period')}</TableHead>
            <TableHead>{t('history.extension')}</TableHead>
            {canEdit ? <TableHead col="actions" className="text-right"><span className="sr-only">{t('history.actions')}</span></TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {stands.map((stand) => {
            const v = stand.effective;
            // Bei „Nein“ fragt niemand nach Zeitraum und Dauerfrist — dort steht „—“ (Designer Runde 8, 346). Die USt-IdNr. bleibt:
            // Sie gilt weiter und macht EU-Dienstleistungen steuerpflichtig (§ 3a Abs. 2 S. 3 UStG, Befund 37), wie das Formular sagt.
            const asked = v.entrepreneur !== false;
            return (
              <TableRow key={stand.validFrom} data-testid="vat-history-row">
                <TableCell col="title" className="tabular-nums text-ink">{fmt.date(stand.validFrom)}</TableCell>
                <TableCell col="meta">{flag(v.entrepreneur)}</TableCell>
                <TableCell col="meta" selectable>{v.vatId ? <span className="font-mono">{v.vatId}</span> : <Empty />}</TableCell>
                <TableCell col="meta">{asked ? t(`advancePeriod.${v.advancePeriod}`) : <Empty />}</TableCell>
                <TableCell>{asked ? flag(v.permanentExtension) : <Empty />}</TableCell>
                {canEdit ? (
                  <TableCell col="actions" className="text-right">
                    <RowMenu name={t('history.name', { date: fmt.date(stand.validFrom) })} items={[{ key: 'remove', label: t('history.remove'), onSelect: () => setRemoving(stand.removal) }]} />
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('history.removeTitle')}
        // N11 c: die festgeschriebenen Buchungen, für die danach der vorige Stand gilt.
        description={removing ? `${t('history.removeDescription', { date: fmt.date(removing.validFrom) })} ${t('history.removeImpact', { count: removing.finalizedEntries })}` : ''}
        confirmLabel={t('history.removeConfirm')}
        destructive
        action={async () => {
          const result = await removeVatSettingsAction(removing!.validFrom);
          if (result.status === 'success') router.refresh();
          return result;
        }}
      />
    </div>
  );
}
