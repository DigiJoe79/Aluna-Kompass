'use client';

import type { AuditReportView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Section } from '@/components/section';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/actions';
import { joinNames } from '../audit-header';
import { saveDeviationAction, saveResultAction } from '../actions';
import { useLastChanged } from './card-note';
import { TIGHT } from './subject-block';
import { useUnsavedCard } from './unsaved-cards';

type Result = AuditReportView['results'][number];

/**
 * Karte „Ergebnis“ (Board 12d): Ergebnis* und Empfehlung (mit „Keine Angabe“), Kompass schlägt vor; dazu
 * „Abweichende Feststellungen · <eigener Name>“, die nur der jeweilige Prüfer bearbeitet. Bei getrennten Berichten hat
 * jeder Prüfer eine eigene Karte (Rückmeldung Runde 3), nur die eigene ist bearbeitbar.
 */
export function ResultCards({ report, canEdit, names }: { report: AuditReportView; canEdit: boolean; names: Record<string, string> }) {
  const separate = report.signatures.mode === 'separate';
  return (
    <>
      {report.results.map((r) => (
        <ResultCard key={r.auditorId ?? 'all'} report={report} result={r} editable={canEdit && (!separate || r.auditorId === report.myAuditorId)} names={names} />
      ))}
    </>
  );
}

function ResultCard({ report, result, editable, names }: { report: AuditReportView; result: Result; editable: boolean; names: Record<string, string> }) {
  const t = useTranslations('finance.audit.report.result');
  const tAudit = useTranslations('finance.audit');
  const router = useRouter();
  const lastChanged = useLastChanged(names);
  const owner = result.auditorId ? report.auditors.find((a) => a.id === result.auditorId) : null;
  const me = report.auditors.find((a) => a.id === report.myAuditorId) ?? null;
  const mine = report.deviations.find((d) => d.auditorId === report.myAuditorId) ?? null;
  // Abweichende Feststellungen gehören in die Karte des Prüfers: gemeinsam in die eine, getrennt in die eigene.
  const withDeviation = editable && me !== null && (result.auditorId === null || result.auditorId === me.id);
  const papers = report.auditors.filter((a) => a.mode === 'paper' && a.id !== me?.id).map((a) => a.contactName);
  const initial = { result: result.result, recommendation: result.recommendation, deviation: mine?.text ?? '' };
  const [v, setV] = useState(initial);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const resultChanged = v.result !== initial.result || v.recommendation !== initial.recommendation;
  const deviationChanged = v.deviation !== initial.deviation;
  const changed = [v.result !== initial.result, v.recommendation !== initial.recommendation, deviationChanged].filter(Boolean).length;
  const title = owner ? t('titleOf', { name: owner.contactName }) : t('title');
  useUnsavedCard(`result:${result.auditorId ?? 'all'}`, title, editable && changed > 0);

  const save = async () => {
    setPending(true);
    const run = async (): Promise<ActionState> => {
      if (resultChanged) {
        const saved = await saveResultAction({ reportId: report.id, expectedVersion: result.version, result: v.result, recommendation: v.recommendation });
        if (saved.status !== 'success') return saved;
      }
      if (deviationChanged) return saveDeviationAction({ reportId: report.id, ...(mine ? { expectedVersion: mine.updatedAt } : {}), text: v.deviation });
      return { status: 'success' };
    };
    const outcome = await feedback.run(run, { retry: () => void save() });
    setPending(false);
    if (outcome.status === 'success') router.refresh();
  };

  if (!editable) {
    return (
      <FormCard as="section" data-testid="result-card">
        <FormCardBody>
          <Section title={title}>
            {owner?.mode === 'paper' ? <p className="mb-2 text-meta text-muted-ink">{t('paperEmpty')}</p> : null}
            <FormGrid>
              <FixedValue id={`result-${result.auditorId ?? 'all'}`} label={t('result')} value={result.result ? t(result.result) : null} describedBy={`result-note-${result.auditorId ?? 'all'}`} size="m" className={TIGHT} />
              <FixedValue id={`recommendation-${result.auditorId ?? 'all'}`} label={t('recommendation')} value={t(result.recommendation)} describedBy={`result-note-${result.auditorId ?? 'all'}`} size="m" className={TIGHT} />
            </FormGrid>
            {result.result === 'clean' ? <OpenRemarksNotice count={report.openRemarks} /> : null}
            <p id={`result-note-${result.auditorId ?? 'all'}`} className="mt-2 text-hint text-muted-ink">
              {lastChanged(result.updatedByUserId, result.updatedAt) ?? ''}
            </p>
          </Section>
        </FormCardBody>
      </FormCard>
    );
  }

  const id = result.auditorId ?? 'all';
  return (
    <FormCard
      as="form"
      data-testid="result-card"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void save();
      }}
    >
      <FormCardBody>
        <Section title={title}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label id={`result-label-${id}`} required>
                {t('result')}
              </Label>
              <Segmented
                aria-labelledby={`result-label-${id}`}
                aria-describedby={`result-hint-${id}`}
                value={v.result ?? undefined}
                onValueChange={(result) => setV({ ...v, result })}
                options={[
                  { value: 'clean', label: t('clean') },
                  { value: 'withFindings', label: t('withFindings') },
                ]}
              />
              <p id={`result-hint-${id}`} className="text-hint text-muted-ink">
                {t(`suggest.${report.suggestedResult}`)}
              </p>
              {v.result === 'clean' ? <OpenRemarksNotice count={report.openRemarks} /> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label id={`recommendation-label-${id}`}>{t('recommendation')}</Label>
              <Segmented
                aria-labelledby={`recommendation-label-${id}`}
                value={v.recommendation}
                onValueChange={(recommendation) => setV({ ...v, recommendation })}
                options={[
                  { value: 'discharge', label: t('discharge') },
                  { value: 'noDischarge', label: t('noDischarge') },
                  { value: 'none', label: t('none') },
                ]}
              />
            </div>
            {withDeviation ? (
              <FormGrid>
                <FormField id={`deviation-${id}`} label={t('deviation', { name: me!.contactName })} hint={papers.length > 0 ? t('deviationHintPaper', { names: joinNames(papers, tAudit('head.and')) }) : t('deviationHint')} size="full">
                  <Textarea id={`deviation-${id}`} value={v.deviation} rows={3} maxLength={4000} onChange={(e) => setV({ ...v, deviation: e.target.value })} />
                </FormField>
              </FormGrid>
            ) : null}
          </div>
        </Section>
      </FormCardBody>
      <FormActionBar count={changed} onSave={() => void save()} onDiscard={() => setV(initial)} pending={pending} note={lastChanged(result.updatedByUserId, result.updatedAt)} state={feedback.state} saveTestId={`result-save-${id}`} />
    </FormCard>
  );
}

/** N15: „Ohne Beanstandung“ trotz ungeklärter Vermerke — eine Warnung ohne Sperre, die Entscheidung gehört den Prüfern. */
function OpenRemarksNotice({ count }: { count: number }) {
  const t = useTranslations('finance.audit.report.result');
  if (count === 0) return null;
  return (
    <Notice level="warn" testId="open-remarks-notice">
      {t('openRemarks', { count })}
    </Notice>
  );
}
