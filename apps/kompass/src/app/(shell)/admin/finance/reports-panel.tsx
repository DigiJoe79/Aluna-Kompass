'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid, FormRowBreak } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { setReportSettingsAction } from './actions';

export interface ReportSettingsValues {
  statuteReference: string;
  cashReportSignature: boolean;
  /** Satzung: Schatzmeister ist Vorstand nach § 26 BGB (Amtsübergabe, Hinweis Registeranmeldung) — `null`: keine Angabe. */
  treasurerIsStatutoryBoard: boolean | null;
}

type Board = 'yes' | 'no' | 'unknown';
const boardOf = (v: boolean | null): Board => (v === true ? 'yes' : v === false ? 'no' : 'unknown');
const boardValue = (b: Board): boolean | null => (b === 'yes' ? true : b === 'no' ? false : null);

/**
 * Einrichtung › Finanzen › Berichte (Plan A3 Task 6b, MUSTER § D): die zwei Einstellungen, die A2 für den Kassenbericht
 * angelegt hat — Satzungsfundstelle im Untertitel und Unterschriftszeile. Eine Formularkarte, gespeichert über die
 * Leiste (`setReportSettings`).
 */
export function ReportsPanel({ values }: { values: ReportSettingsValues }) {
  const t = useTranslations('finance.admin.reports');
  const router = useRouter();
  const [v, setV] = useState(values);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const changed = (Object.keys(values) as (keyof ReportSettingsValues)[]).filter((k) => v[k] !== values[k]).length;

  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => setReportSettingsAction({ statuteReference: v.statuteReference, cashReportSignature: v.cashReportSignature, treasurerIsStatutoryBoard: v.treasurerIsStatutoryBoard }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    router.refresh();
  };

  return (
    <FormCard
      as="form"
      data-testid="reports-panel"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void save();
      }}
    >
      <FormCardBody>
        <Section title={t('cashReport')} intro={t('cashReportIntro')}>
          <FormGrid>
            <FormField id="reports-statute" label={t('statuteReference')} hint={t('statuteReferenceHint')} error={errors.statuteReference} size="m">
              <Input id="reports-statute" value={v.statuteReference} maxLength={80} onChange={(e) => setV({ ...v, statuteReference: e.target.value })} />
            </FormField>
            {/* Der Schalter in eigener Zeile unter dem Feld (Designer Runde 7, 259). */}
            <FormRowBreak />
            <FormField id="reports-signature" label={t('cashReportSignature')} toggle size="m">
              <Switch id="reports-signature" checked={v.cashReportSignature} onCheckedChange={(on) => setV({ ...v, cashReportSignature: on })} />
            </FormField>
          </FormGrid>
        </Section>
        <Section title={t('statute')} intro={t('statuteIntro')}>
          <div className="flex flex-col gap-1.5">
            <Label id="reports-board-label">{t('treasurerIsStatutoryBoard')}</Label>
            <Segmented
              aria-labelledby="reports-board-label"
              value={boardOf(v.treasurerIsStatutoryBoard)}
              onValueChange={(b) => setV({ ...v, treasurerIsStatutoryBoard: boardValue(b) })}
              options={(['yes', 'no', 'unknown'] as const).map((b) => ({ value: b, label: t(`board.${b}`) }))}
              testId="reports-board"
            />
            <p className="text-hint text-muted-ink">{t('treasurerIsStatutoryBoardHint')}</p>
          </div>
        </Section>
      </FormCardBody>
      <FormActionBar count={changed} onSave={() => void save()} onDiscard={() => setV(values)} pending={pending} state={withUnplacedFieldErrors(feedback.state, ['statuteReference'])} saveTestId="reports-settings-save" />
    </FormCard>
  );
}
