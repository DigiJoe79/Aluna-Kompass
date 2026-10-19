'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid, FormRowBreak } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { saveSepaSettingsAction } from './actions';

export interface DirectDebitSettingsValues {
  enabled: boolean;
  creditorId: string;
  creditorName: string;
  /** Leer: das Hauptkonto. */
  accountId: string;
  leadBusinessDays: number;
  maxLeadDays: number;
  preNotificationDays: number;
  batchBooking: boolean;
  prefix: string;
  digits: number;
}

/**
 * Einstellungen › Finanzen › Lastschrift (Handoff 2a § 2, Spec § 7.1): Schalter, Gläubiger-Daten, Konto, Fristen der
 * Bank und das Format der Mandatsreferenz. Eine Formularkarte, gespeichert über die Leiste (`saveSepaSettings`).
 */
export function DirectDebitPanel({ values, accounts, organizationName }: { values: DirectDebitSettingsValues; accounts: { id: string; name: string; isMain: boolean }[]; organizationName: string }) {
  const t = useTranslations('finance.admin.directDebit');
  const router = useRouter();
  const [v, setV] = useState(values);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const changed = (Object.keys(values) as (keyof DirectDebitSettingsValues)[]).filter((k) => String(v[k]) !== String(values[k])).length;
  const set = <K extends keyof DirectDebitSettingsValues>(key: K, value: DirectDebitSettingsValues[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const example = `${v.prefix}${'1'.padStart(Math.max(1, Math.min(10, Number(v.digits) || 1)), '0')}`;

  const save = async () => {
    setPending(true);
    const result = await feedback.run(
      () =>
        saveSepaSettingsAction({
          enabled: v.enabled,
          creditorId: v.creditorId.trim() || null,
          creditorName: v.creditorName.trim() || null,
          accountId: v.accountId || null,
          leadBusinessDays: Number(v.leadBusinessDays),
          maxLeadDays: Number(v.maxLeadDays),
          preNotificationDays: Number(v.preNotificationDays),
          batchBooking: v.batchBooking,
          mandateReferenceFormat: { prefix: v.prefix, digits: Number(v.digits) },
        }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message);
    router.refresh();
  };

  return (
    <FormCard as="form" data-testid="direct-debit-panel" onSubmit={(e: React.FormEvent) => { e.preventDefault(); void save(); }}>
      <FormCardBody>
        <Section title={t('use')} intro={t('useIntro')}>
          <FormGrid>
            <FormField id="sepa-enabled" label={t('enabled')} toggle>
              <Switch id="sepa-enabled" checked={v.enabled} onCheckedChange={(on) => set('enabled', on)} />
            </FormField>
          </FormGrid>
        </Section>
        <Section title={t('creditor')} intro={t('creditorIntro')}>
          <FormGrid>
            <FormField id="sepa-creditor-id" label={t('creditorId')} hint={t('creditorIdHint')} error={errors.creditorId}>
              <Input id="sepa-creditor-id" value={v.creditorId} autoComplete="off" spellCheck={false} onChange={(e) => set('creditorId', e.target.value)} />
            </FormField>
            <FormField id="sepa-creditor-name" label={t('creditorName')} hint={t('creditorNameHint')} error={errors.creditorName}>
              <Input id="sepa-creditor-name" value={v.creditorName} maxLength={70} placeholder={organizationName} onChange={(e) => set('creditorName', e.target.value)} />
            </FormField>
            <FormField id="sepa-account" label={t('account')} hint={t('accountHint')} error={errors.accountId}>
              <Select id="sepa-account" value={v.accountId} onChange={(e) => set('accountId', e.target.value)}>
                <option value="">{t('mainAccount')}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </FormField>
          </FormGrid>
        </Section>
        <Section title={t('deadlines')} intro={t('deadlinesIntro')}>
          <FormGrid>
            <FormField id="sepa-prenotification" label={t('preNotificationDays')} hint={t('preNotificationHint')} size="s" error={errors.preNotificationDays}>
              <Input id="sepa-prenotification" type="number" min={1} max={30} unit={t('days')} value={String(v.preNotificationDays)} onChange={(e) => set('preNotificationDays', Number(e.target.value))} />
            </FormField>
            <FormField id="sepa-max-lead" label={t('maxLeadDays')} hint={t('maxLeadHint')} size="s" error={errors.maxLeadDays}>
              <Input id="sepa-max-lead" type="number" min={1} max={60} unit={t('days')} value={String(v.maxLeadDays)} onChange={(e) => set('maxLeadDays', Number(e.target.value))} />
            </FormField>
            <FormField id="sepa-lead" label={t('leadBusinessDays')} hint={t('leadHint')} size="s" error={errors.leadBusinessDays}>
              <Input id="sepa-lead" type="number" min={1} max={10} unit={t('businessDays')} value={String(v.leadBusinessDays)} onChange={(e) => set('leadBusinessDays', Number(e.target.value))} />
            </FormField>
            <FormRowBreak />
            <FormField id="sepa-batch" label={t('batchBooking')} hint={t('batchBookingHint')} toggle>
              <Switch id="sepa-batch" checked={v.batchBooking} onCheckedChange={(on) => set('batchBooking', on)} />
            </FormField>
          </FormGrid>
        </Section>
        <Section title={t('reference')} intro={t('referenceIntro')}>
          <FormGrid>
            <FormField id="sepa-prefix" label={t('prefix')} size="s" error={errors['mandateReferenceFormat.prefix']}>
              <Input id="sepa-prefix" value={v.prefix} maxLength={20} onChange={(e) => set('prefix', e.target.value)} />
            </FormField>
            <FormField id="sepa-digits" label={t('digits')} hint={t('example', { example })} size="s" error={errors['mandateReferenceFormat.digits']}>
              <Input id="sepa-digits" type="number" min={1} max={10} value={String(v.digits)} onChange={(e) => set('digits', Number(e.target.value))} />
            </FormField>
          </FormGrid>
        </Section>
      </FormCardBody>
      <FormActionBar count={changed} onSave={() => void save()} onDiscard={() => setV(values)} pending={pending} state={feedback.state} saveTestId="direct-debit-save" />
    </FormCard>
  );
}
