'use client';

import type { StatuteContext } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { CountField } from '@/components/count-field';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { updateStatuteAction } from '../../actions';

type Tri = 'yes' | 'no' | 'open';
const tri = (v: boolean | null): Tri => (v === null ? 'open' : v ? 'yes' : 'no');
const fromTri = (v: Tri): boolean | null => (v === 'open' ? null : v === 'yes');
const doc = (d: { id: string; number: string | null } | null, subject = ''): PickedDocument | null => (d ? { id: d.id, number: d.number, subject, phase: 'issued' } : null);

/**
 * Stand bearbeiten (Vorgang, Plan U2 Task 10): Fassung, Wortlaut, Beschluss (nur ohne verknüpften Beschluss), Bewertung
 * durch das Finanzamt, beim Gründungsstand die Gründung. Gespeichert werden nur geänderte Felder.
 */
export function StatuteForm({ context, canPickDocuments, labelOf }: { context: StatuteContext; canPickDocuments: boolean; labelOf: { resolution: string | null } }) {
  const t = useTranslations('governance.statute');
  const router = useRouter();
  const s = context.statute;
  const linked = s.resolutions.some((r) => r.resolutionId !== null);
  const initial = useMemo(
    () => ({
      note: s.note ?? '',
      document: doc(context.document, context.document?.subject),
      resolvedOn: !linked ? (s.resolutions[0]?.on ?? '') : '',
      affects: tri(s.taxReview.affectsCharity),
      submittedOn: s.taxReview.submittedOn ?? '',
      submission: doc(context.taxDocuments.submission),
      answer: s.taxReview.answer ?? '',
      answerDoc: doc(context.taxDocuments.answer),
      signatures: s.foundingChecks?.signatures === null || s.foundingChecks?.signatures === undefined ? '' : String(s.foundingChecks.signatures),
      establishedOn: s.foundingChecks?.establishedOn ?? '',
    }),
    [s, context, linked],
  );
  const [v, setV] = useState(initial);
  const set = <K extends keyof typeof initial>(k: K, value: (typeof initial)[K]) => setV((x) => ({ ...x, [k]: value }));
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const changedKeys = (Object.keys(initial) as (keyof typeof initial)[]).filter((k) => !same(v[k] && typeof v[k] === 'object' ? (v[k] as { id: string }).id : v[k], initial[k] && typeof initial[k] === 'object' ? (initial[k] as { id: string }).id : initial[k]));
  const founding = s.basedOnId === null;

  const save = async () => {
    const input: Record<string, unknown> & { id: string } = { id: s.id };
    if (changedKeys.includes('note')) input.note = v.note.trim() || null;
    if (changedKeys.includes('document')) input.documentId = v.document?.id ?? null;
    if (changedKeys.includes('resolvedOn')) input.resolutions = v.resolvedOn ? [{ on: v.resolvedOn, resolutionId: null }] : [];
    if (['affects', 'submittedOn', 'submission', 'answer', 'answerDoc'].some((k) => changedKeys.includes(k as keyof typeof initial)))
      input.taxReview = { affectsCharity: fromTri(v.affects), submittedOn: v.submittedOn || null, submissionDocumentId: v.submission?.id ?? null, answer: v.answer || null, answerDocumentId: v.answerDoc?.id ?? null };
    if (founding && (changedKeys.includes('signatures') || changedKeys.includes('establishedOn'))) input.foundingChecks = { signatures: v.signatures === '' ? null : Number(v.signatures), establishedOn: v.establishedOn || null };
    setPending(true);
    const result = await feedback.run(() => updateStatuteAction(input), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message ?? '');
    router.push(`/governance/statutes/${s.id}`);
  };

  return (
    <FormCard>
      <FormCardBody>
        <Section title={t('version')}>
          <FormGrid>
            <FormField id="statute-note" label={t('note')} size="l" error={errors.note}>
              <Input id="statute-note" value={v.note} onChange={(e) => set('note', e.target.value)} />
            </FormField>
          </FormGrid>
        </Section>
        <Section title={t('text')}>
          <FormGrid>
            {canPickDocuments ? (
              <FormCell size="l">
                <DocumentPicker id="statute-document" name="documentId" label={t('textDocument')} value={v.document} onChange={(d) => set('document', d)} />
              </FormCell>
            ) : (
              <FixedValue id="statute-document" label={t('textDocument')} value={context.document?.number ?? null} reason={t('noDocumentRight')} />
            )}
          </FormGrid>
        </Section>
        <Section title={t('resolution')}>
          <FormGrid>
            {linked ? (
              <FixedValue id="statute-resolution" label={t('resolution')} value={labelOf.resolution} reason={t('resolutionFixed')} />
            ) : (
              <FormField id="statute-resolved-on" label={t('resolvedOnField')} hint={t('resolvedOnHint')} size="s" error={errors['resolutions.0.on'] ?? errors.resolutions}>
                <Input id="statute-resolved-on" type="date" value={v.resolvedOn} onChange={(e) => set('resolvedOn', e.target.value)} />
              </FormField>
            )}
          </FormGrid>
        </Section>
        <Section title={t('tax')}>
          <FormGrid>
            <FormField id="statute-affects" label={t('taxQuestion')} size="full">
              <Segmented<Tri> className="self-start" aria-label={t('taxQuestion')} value={v.affects} onValueChange={(x) => set('affects', x)} options={(['yes', 'no', 'open'] as const).map((x) => ({ value: x, label: t(`tri.${x}`) }))} />
            </FormField>
            <FormField id="statute-submitted" label={t('submittedOn')} size="s" error={errors['taxReview.submittedOn']}>
              <Input id="statute-submitted" type="date" value={v.submittedOn} onChange={(e) => set('submittedOn', e.target.value)} />
            </FormField>
            {canPickDocuments ? (
              <FormCell size="m">
                <DocumentPicker id="statute-submission" name="submissionDocumentId" label={t('submission')} value={v.submission} onChange={(d) => set('submission', d)} />
              </FormCell>
            ) : null}
            <FormField id="statute-answer" label={t('answer')} size="s">
              <Select id="statute-answer" value={v.answer} onChange={(e) => set('answer', e.target.value as typeof v.answer)}>
                <option value="">{t('answers.none')}</option>
                <option value="notRelevant">{t('answers.notRelevant')}</option>
                <option value="newNotice">{t('answers.newNotice')}</option>
              </Select>
            </FormField>
            {canPickDocuments ? (
              <FormCell size="m">
                <DocumentPicker id="statute-answer-doc" name="answerDocumentId" label={t('answerDocument')} value={v.answerDoc} onChange={(d) => set('answerDoc', d)} />
              </FormCell>
            ) : null}
          </FormGrid>
        </Section>
        {founding ? (
          <Section title={t('founding')}>
            <FormGrid>
              <FormField id="statute-signatures" label={t('signatures')} size="s" error={errors['foundingChecks.signatures']}>
                <CountField id="statute-signatures" min={0} max={1000} value={v.signatures} onChange={(e) => set('signatures', e.target.value)} />
              </FormField>
              <FormField id="statute-established" label={t('establishedOn')} size="s" error={errors['foundingChecks.establishedOn']}>
                <Input id="statute-established" type="date" value={v.establishedOn} onChange={(e) => set('establishedOn', e.target.value)} />
              </FormField>
            </FormGrid>
          </Section>
        ) : null}
      </FormCardBody>
      <FormActionBar mode="edit" onSave={() => void save()} pending={pending} count={changedKeys.length} onDiscard={() => setV(initial)} state={feedback.state} />
    </FormCard>
  );
}
