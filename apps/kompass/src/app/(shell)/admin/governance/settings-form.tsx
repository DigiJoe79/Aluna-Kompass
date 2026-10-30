'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CountField } from '@/components/count-field';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { Select } from '@/components/ui/select';
import { saveGovernanceSettingsAction } from './actions';

export interface GovernanceSettingsValues {
  deadlineLeadDays: number;
  registerOverdueDays: number;
  taxNoticeRequestDays: number;
  /** `MM-TT` */
  ordinaryMeetingWarnFrom: string;
}

/**
 * Einstellungen Gremien (Plan U1 Task 12, MUSTER § D/§ E wie „Nummern und Fristen“ der Mitglieder): eine Karte mit den
 * Fristen als Zählfeldern, gespeichert mit dem Formular. Ohne `settings.manage` bleiben die Felder gesperrt, der Satz neben der Leiste sagt warum.
 */
export function GovernanceSettingsForm({ values, canChange }: { values: GovernanceSettingsValues; canChange: boolean }) {
  const t = useTranslations('governance.admin');
  const router = useRouter();
  const [v, setV] = useState(values);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const fields = Object.keys(values) as (keyof GovernanceSettingsValues)[];
  const changedKeys = fields.filter((k) => v[k] !== values[k]);
  const changed = changedKeys.length;
  const unit = { one: t('days.one'), other: t('days.other') };
  const number = (raw: string) => Math.max(0, Number.parseInt(raw, 10) || 0);

  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => saveGovernanceSettingsAction(Object.fromEntries(changedKeys.map((k) => [k, v[k]]))), { retry: () => void save() });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  const [month, day] = v.ordinaryMeetingWarnFrom.split('-');
  const setWarn = (m: string, d: string) => setV({ ...v, ordinaryMeetingWarnFrom: `${m}-${d}` });
  const field = (key: Exclude<keyof GovernanceSettingsValues, 'ordinaryMeetingWarnFrom'>, label: string, hint: string) => (
    <FormField id={`governance-${key}`} label={label} hint={hint} size="full">
      <CountField id={`governance-${key}`} unit={unit} min={0} max={365} value={v[key]} disabled={!canChange || pending} onChange={(e) => setV({ ...v, [key]: number(e.target.value) })} />
    </FormField>
  );

  return (
    <FormCard
      as="form"
      data-testid="governance-settings"
      onSubmit={(e: React.FormEvent) => { e.preventDefault(); void save(); }}
    >
      <FormCardBody>
        <Section title={t('deadlines')}>
          <FormGrid>
            {field('deadlineLeadDays', t('lead'), t('leadHint'))}
            {field('registerOverdueDays', t('registerOverdue'), t('registerOverdueHint'))}
            {field('taxNoticeRequestDays', t('taxNotice'), t('taxNoticeHint'))}
            <FormField id="governance-warn-day" label={t('warnFromDay')} hint={t('warnFromHint')} size="s">
              <Select id="governance-warn-day" value={day} disabled={!canChange || pending} onChange={(e) => setWarn(month!, e.target.value)}>
                {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => <option key={d} value={d}>{Number(d)}.</option>)}
              </Select>
            </FormField>
            <FormField id="governance-warn-month" label={t('warnFromMonth')} size="s">
              <Select id="governance-warn-month" value={month} disabled={!canChange || pending} onChange={(e) => setWarn(e.target.value, day!)}>
                {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => <option key={m} value={m}>{t(`months.${Number(m)}`)}</option>)}
              </Select>
            </FormField>
          </FormGrid>
        </Section>
      </FormCardBody>
      <FormActionBar
        count={changed}
        onSave={() => void save()}
        onDiscard={() => setV(values)}
        pending={pending}
        state={feedback.state}
        note={canChange ? undefined : <span className="text-hint text-muted-ink">{t('noRight')}</span>}
        saveTestId="governance-settings-save"
      />
    </FormCard>
  );
}
