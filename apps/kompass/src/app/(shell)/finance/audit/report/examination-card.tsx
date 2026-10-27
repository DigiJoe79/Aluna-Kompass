'use client';

import type { AuditReportView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { saveExaminationAction } from '../actions';
import { useLastChanged } from './card-note';
import { TIGHT } from './subject-block';
import { useUnsavedCard } from './unsaved-cards';

/**
 * Karte „Prüfung · von den Prüfern“ (Board 12d): Geprüft am (ein oder mehr Tage), Ort, „Nicht geprüft“ und — bei
 * mehreren Zählungen mit Zeugen — welche in den Bericht geht. Speichert für sich mit eigenem Stand; ohne Bearbeitungsrecht
 * steht alles als Text.
 */
export function ExaminationCard({ report, canEdit, names, cashCounts }: { report: AuditReportView; canEdit: boolean; names: Record<string, string>; cashCounts: { id: string; label: string }[] }) {
  const t = useTranslations('finance.audit.report');
  const fmt = useDateFormat();
  const router = useRouter();
  const lastChanged = useLastChanged(names);
  const exam = report.examination;
  const initial = { dates: exam.dates.length > 0 ? exam.dates : [''], place: exam.place ?? '', notTested: exam.notTested ?? '', cashCountId: exam.cashCountId ?? '' };
  const [v, setV] = useState(initial);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const changed = [v.dates.join(',') !== initial.dates.join(','), v.place !== initial.place, v.notTested !== initial.notTested, v.cashCountId !== initial.cashCountId].filter(Boolean).length;
  useUnsavedCard('exam', t('exam.title'), canEdit && changed > 0);

  const save = async () => {
    setPending(true);
    const result = await feedback.run(
      () => saveExaminationAction({ reportId: report.id, expectedVersion: exam.version, dates: v.dates.filter(Boolean), place: v.place.trim() || null, notTested: v.notTested.trim() || null, cashCountId: v.cashCountId || null }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status !== 'success') return;
    // Wie der Dienst: Tage sortiert und einmalig — sonst zählte die Leiste nach dem Speichern weiter „geändert“.
    const dates = [...new Set(v.dates.filter(Boolean))].sort();
    setV({ ...v, dates: dates.length > 0 ? dates : [''], place: v.place.trim(), notTested: v.notTested.trim() });
    router.refresh();
  };

  if (!canEdit) {
    return (
      <FormCard as="section" data-testid="exam-card">
        <FormCardBody>
          <Section title={t('exam.title')}>
            <FormGrid>
              <FixedValue id="exam-dates" label={t('exam.dates')} value={exam.dates.map((d) => fmt.date(d)).join(', ') || null} describedBy="exam-reason" size="m" className={TIGHT} />
              <FixedValue id="exam-place" label={t('exam.place')} value={exam.place} describedBy="exam-reason" size="m" className={TIGHT} />
              <FixedValue id="exam-not-tested" label={t('exam.notTested')} value={exam.notTested ?? t('exam.noneNotTested')} describedBy="exam-reason" size="full" className={TIGHT} />
            </FormGrid>
            <p id="exam-reason" className="mt-2 text-hint text-muted-ink">
              {lastChanged(exam.updatedByUserId, exam.updatedAt) ?? ''}
            </p>
          </Section>
        </FormCardBody>
      </FormCard>
    );
  }

  return (
    <FormCard
      as="form"
      data-testid="exam-card"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void save();
      }}
    >
      <FormCardBody>
        <Section title={t('exam.title')}>
          <div className="flex flex-col gap-4">
            <FormGrid>
              {v.dates.map((date, i) => (
                <FormField key={i} id={`exam-date-${i}`} label={i === 0 ? t('exam.dates') : `${t('exam.dates')} (${i + 1})`} required={i === 0} size="s" error={i === 0 ? errors.dates : undefined}>
                  {i === 0 ? (
                    <Input id={`exam-date-${i}`} type="date" value={date} onChange={(e) => setV({ ...v, dates: v.dates.map((d, j) => (j === i ? e.target.value : d)) })} />
                  ) : (
                    // Ein hinzugefügter Tag lässt sich wieder entfernen, der erste nicht (Plan D1d Task 6).
                    <div className="flex items-center gap-2">
                      <Input id={`exam-date-${i}`} type="date" value={date} onChange={(e) => setV({ ...v, dates: v.dates.map((d, j) => (j === i ? e.target.value : d)) })} />
                      <Button type="button" variant="outline" size="sm" aria-label={t('exam.removeDateOf', { n: i + 1 })} onClick={() => setV({ ...v, dates: v.dates.filter((_, j) => j !== i) })}>
                        {t('exam.removeDate')}
                      </Button>
                    </div>
                  )}
                </FormField>
              ))}
              <FormField id="exam-place" label={t('exam.place')} size="m" error={errors.place}>
                <Input id="exam-place" value={v.place} maxLength={200} onChange={(e) => setV({ ...v, place: e.target.value })} />
              </FormField>
            </FormGrid>
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setV({ ...v, dates: [...v.dates, ''] })}>
                {t('exam.addDate')}
              </Button>
            </div>
            <FormGrid>
              <FormField id="exam-not-tested" label={t('exam.notTested')} hint={t('exam.notTestedHint')} size="full" error={errors.notTested}>
                <Textarea id="exam-not-tested" value={v.notTested} rows={3} onChange={(e) => setV({ ...v, notTested: e.target.value })} />
              </FormField>
              {cashCounts.length > 1 ? (
                <FormField id="exam-cash" label={t('exam.cashCount')} size="m">
                  <Select id="exam-cash" value={v.cashCountId || cashCounts[0]!.id} onChange={(e) => setV({ ...v, cashCountId: e.target.value === cashCounts[0]!.id ? '' : e.target.value })}>
                    {cashCounts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
            </FormGrid>
          </div>
        </Section>
      </FormCardBody>
      <FormActionBar count={changed} onSave={() => void save()} onDiscard={() => setV(initial)} pending={pending} note={lastChanged(exam.updatedByUserId, exam.updatedAt)} state={withUnplacedFieldErrors(feedback.state, ['dates', 'place', 'notTested'])} saveTestId="exam-save" />
    </FormCard>
  );
}
