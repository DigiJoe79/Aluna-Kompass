'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import type { ActionState } from '@/lib/actions';
import { AgentSwitchSection, agentSwitchChange } from '../agent-switch-section';
import { saveMembersSettingsAction, setNextMemberNumberAction } from './actions';

const AGENT_KEY = 'members.mcpHumanOnlyAllowed';

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
 * Zahlungsziel in Briefen und Beitrag im Eintrittsjahr. Eine Formularkarte, gespeichert über die Leiste. Als letzter
 * Abschnitt der Agentenschalter (`AgentSwitchSection`, Plan U4 Task 1), der mit dem Formular gespeichert wird; ändern
 * darf ihn nur, wer `settings.manage` hat — der Dienst prüft.
 */
export function NumbersPanel({ values, agent }: { values: NumbersValues; agent: { allowed: boolean; canChange: boolean } }) {
  const t = useTranslations('members.admin.numbers');
  const tAgent = useTranslations('members.admin.agent');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [v, setV] = useState(values);
  const [agentAllowed, setAgentAllowed] = useState(agent.allowed);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const agentChanged = agentAllowed !== agent.allowed;
  const changed = (Object.keys(values) as (keyof NumbersValues)[]).filter((k) => String(v[k]) !== String(values[k])).length + (agentChanged ? 1 : 0);

  const save = async () => {
    setPending(true);
    const result = await feedback.run(async (): Promise<ActionState> => {
      if (Number(v.nextNumber) !== values.nextNumber) {
        const next = await setNextMemberNumberAction(Number(v.nextNumber));
        if (next.status !== 'success') return next;
      }
      return saveMembersSettingsAction({ resignationNotice: { months: Number(v.noticeMonths), at: v.noticeAt }, paymentTermDays: Number(v.paymentTermDays), joinYearRule: v.joinYearRule }, 'numbers', agentChanged ? agentAllowed : undefined);
    }, { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message);
    router.refresh();
  };

  return (
    <FormCard
      as="form"
      ref={form}
      data-testid="numbers-panel"
      onSubmit={(e: React.FormEvent) => { e.preventDefault(); void save(); }}
      onChange={(e: React.FormEvent) => {
        const next = agentSwitchChange(e, AGENT_KEY);
        if (next !== null) setAgentAllowed(next);
      }}
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
        <AgentSwitchSection name={AGENT_KEY} label={tAgent('label')} hint={tAgent('hint')} checked={agent.allowed} disabled={!agent.canChange || pending} />
      </FormCardBody>
      <FormActionBar
        count={changed}
        onSave={() => void save()}
        onDiscard={() => {
          setV(values);
          setAgentAllowed(agent.allowed);
          form.current?.reset();
        }}
        pending={pending}
        state={feedback.state}
        saveTestId="numbers-save"
      />
    </FormCard>
  );
}
