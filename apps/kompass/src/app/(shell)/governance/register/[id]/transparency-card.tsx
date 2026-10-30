'use client';

import type { TransparencyView } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Section } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { transparencyRows } from '@/lib/governance/transparency-rows';
import { saveTransparencyAction } from '../actions';

const MANUAL = ['foreignBoardMember', 'earlierOwnReport', 'controlOtherwise'] as const;
type Answer = 'yes' | 'no';

/**
 * Transparenzregister (Board 8b, Rückmeldung Phase 2): Kompass meldet nichts. Frage 1 rechnet Kompass aus der
 * Anmeldung (fester Wert mit Grund), 2–4 beantwortet man mit ja/nein. Gespeichert über die Leiste ohne Fläche.
 */
export function TransparencyCard({ filingId, view, submittedOn, overdueDays, today, manage, onConfirm }: { filingId: string; view: TransparencyView; submittedOn: string | null; overdueDays: number; today: string; manage: boolean; onConfirm: () => void }) {
  const t = useTranslations('governance.register.transparency');
  const { date } = useDateFormat();
  const router = useRouter();
  const rows = transparencyRows(view, submittedOn);
  const initial = Object.fromEntries(MANUAL.map((k) => [k, rows.manual[k]])) as Record<(typeof MANUAL)[number], Answer | null>;
  const [answers, setAnswers] = useState(initial);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const count = MANUAL.filter((k) => answers[k] !== initial[k]).length;
  const live = transparencyRows({ ...view, answers: { ...view.answers, ...Object.fromEntries(MANUAL.flatMap((k) => (answers[k] ? [[k, answers[k] === 'yes']] : []))) } }, submittedOn);
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => saveTransparencyAction({ filingId, answers: Object.fromEntries(MANUAL.flatMap((k) => (answers[k] ? [[k, answers[k] === 'yes']] : []))), checkedOn: today }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message ?? '');
    router.refresh();
  };
  const reason = rows.q1.reason === 'submittedInTime' ? t('q1Reasons.submittedInTime', { date: rows.q1.on ? date(rows.q1.on) : '', n: overdueDays }) : rows.q1.reason === 'notInTime' ? t('q1Reasons.notInTime', { n: overdueDays }) : t('q1Reasons.openUntil', { date: rows.q1.on ? date(rows.q1.on) : '' });
  return (
    <FormCard as="section">
      <FormCardBody>
        <Section title={t('title')} intro={t('intro')}>
          <FormGrid>
            <FixedValue id="transparency-q1" label={t('q1')} value={t(`values.${rows.q1.value}`)} reason={reason} size="full" />
            {MANUAL.map((k) => (
              <FormField key={k} id={`transparency-${k}`} label={t(`questions.${k}`)} size="full">
                <Segmented<Answer> className="self-start" aria-label={t(`questions.${k}`)} value={answers[k] ?? undefined} disabled={!manage} onValueChange={(v) => setAnswers((a) => ({ ...a, [k]: v }))} options={[{ value: 'yes', label: t('values.yes'), testId: `${k}-yes` }, { value: 'no', label: t('values.no'), testId: `${k}-no` }]} />
              </FormField>
            ))}
          </FormGrid>
          <div className="mt-4">
            {live.result === 'noReportNeeded' ? (
              <p className="flex flex-wrap items-center gap-2 text-body">
                <StatusBadge tone="success" dot>{t('noReport')}</StatusBadge>
                <span>{t('noReportText')}</span>
              </p>
            ) : live.reportNotice ? (
              <Notice level="warn" action={manage && !view.confirmationDocumentId ? <Button type="button" variant="outline" size="sm" onClick={onConfirm}>{t('confirm')}</Button> : undefined}>{t('reportNeeded')}</Notice>
            ) : null}
          </div>
        </Section>
      </FormCardBody>
      {manage ? <FormActionBar surface="plain" mode="edit" onSave={() => void save()} pending={pending} count={count} onDiscard={() => setAnswers(initial)} state={feedback.state} saveTestId="transparency-save" /> : null}
    </FormCard>
  );
}
