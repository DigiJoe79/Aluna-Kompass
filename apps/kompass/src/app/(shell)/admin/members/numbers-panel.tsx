'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import type { ActionState } from '@/lib/actions';
import { saveMembersSettingsAction, setNextMemberNumberAction } from './actions';

type Anchor = 'fiscalYearEnd' | 'quarterEnd' | 'monthEnd' | 'any';
type JoinYear = 'full' | 'proRataMonths' | 'nextYear';
export interface NumbersValues {
  nextNumber: number;
  noticeMonths: number;
  noticeAt: Anchor;
  paymentTermDays: number;
  joinYearRule: JoinYear;
}

/**
 * Nummern und Fristen (Handoff Mitglieder 2.6, Nachtrag Phase 2 § 0): nächste Nummer, Kündigungsfrist mit Stichtag,
 * Zahlungsziel in Briefen und Beitrag im Eintrittsjahr. Eine Formularkarte, gespeichert über die Leiste.
 */
export function NumbersPanel({ values }: { values: NumbersValues }) {
  const t = useTranslations('members.admin.numbers');
  const router = useRouter();
  const [v, setV] = useState(values);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const changed = (Object.keys(values) as (keyof NumbersValues)[]).filter((k) => String(v[k]) !== String(values[k])).length;

  const save = async () => {
    setPending(true);
    const result = await feedback.run(async (): Promise<ActionState> => {
      if (Number(v.nextNumber) !== values.nextNumber) {
        const next = await setNextMemberNumberAction(Number(v.nextNumber));
        if (next.status !== 'success') return next;
      }
      return saveMembersSettingsAction({ resignationNotice: { months: Number(v.noticeMonths), at: v.noticeAt }, paymentTermDays: Number(v.paymentTermDays), joinYearRule: v.joinYearRule }, 'numbers');
    }, { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    router.refresh();
  };

  return (
    <FormCard
      as="form"
      data-testid="numbers-panel"
      onSubmit={(e: React.FormEvent) => { e.preventDefault(); void save(); }}
    >
      <FormCardBody>
        <Section title={t('title')}>
          <FormGrid>
            <FormField id="next-number" label={t('nextNumber')} hint={t('nextNumberHint')} size="s">
              <Input id="next-number" type="number" min={1} value={String(v.nextNumber)} onChange={(e) => setV({ ...v, nextNumber: Number(e.target.value) })} />
            </FormField>
            <FormField id="notice-months" label={t('noticeMonths')} size="s">
              <Input id="notice-months" type="number" min={0} max={24} unit={t('months')} value={String(v.noticeMonths)} onChange={(e) => setV({ ...v, noticeMonths: Number(e.target.value) })} />
            </FormField>
            <FormField id="notice-at" label={t('noticeAt')}>
              <Segmented className="self-start" aria-label={t('noticeAt')} value={v.noticeAt} onValueChange={(noticeAt) => setV({ ...v, noticeAt })} options={(['fiscalYearEnd', 'quarterEnd', 'monthEnd', 'any'] as const).map((a) => ({ value: a, label: t(`anchors.${a}`) }))} />
            </FormField>
            <FormField id="payment-term" label={t('paymentTerm')} size="s">
              <Input id="payment-term" type="number" min={1} max={90} unit={t('days')} value={String(v.paymentTermDays)} onChange={(e) => setV({ ...v, paymentTermDays: Number(e.target.value) })} />
            </FormField>
            <FormField id="join-year" label={t('joinYear')}>
              <Segmented className="self-start" aria-label={t('joinYear')} value={v.joinYearRule} onValueChange={(joinYearRule) => setV({ ...v, joinYearRule })} options={(['full', 'proRataMonths', 'nextYear'] as const).map((r) => ({ value: r, label: t(`joinYearRules.${r}`) }))} />
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
        saveTestId="numbers-save"
      />
    </FormCard>
  );
}
