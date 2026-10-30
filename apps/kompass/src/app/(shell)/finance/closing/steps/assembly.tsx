'use client';

import type { AssemblyPerson, AssemblyResultView, DischargeOutcome } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { useDateFormat } from '@/components/date-format-provider';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { saveAssemblyAction, uploadMinutesAction } from '../actions';
import type { ClosingStepBody } from '../step-body';

const OUTCOMES: readonly DischargeOutcome[] = ['granted', 'refused', 'postponed'];

export interface AssemblyData {
  persons: AssemblyPerson[];
  minutes: PickedDocument | null;
}

type Values = {
  assemblyOn: string;
  minutes: PickedDocument | null;
  accountsApproved: 'yes' | 'no' | 'notVoted' | null;
  dischargeMode: 'individual' | 'collective';
  collectiveOutcome: DischargeOutcome | null;
  discharges: Record<string, DischargeOutcome | null>;
};

function initialOf(result: AssemblyResultView | null, data: AssemblyData): Values {
  return {
    assemblyOn: result?.assemblyOn ?? '',
    minutes: data.minutes,
    accountsApproved: result?.accountsApproved ?? null,
    dischargeMode: result?.dischargeMode ?? 'individual',
    collectiveOutcome: result?.collectiveOutcome ?? null,
    discharges: Object.fromEntries(data.persons.map((p) => [p.contactId, result?.discharges.find((d) => d.contactId === p.contactId)?.outcome ?? null])),
  };
}

/**
 * Schritt 11 „Mitgliederversammlung“ (Board 13d): ein Formular im Schritt (`FormCard` mit Speicherleiste, kein Dialog)
 * — Datum*, Protokoll, „Jahresrechnung genehmigt“ und die Entlastung einzeln (je Vorstandsmitglied des Jahres, ohne
 * Vorwahl) oder gesamt. „verweigert“ oder „vertagt“ lässt den Schritt offen und sperrt nichts. Speichern geht immer;
 * der Dienst nennt die Pflichtfelder.
 */
export function AssemblyStep({ step, status, canConfirm, data, onSaved }: ClosingStepBody<'assembly'> & { data: AssemblyData; /** Nach erfolgreichem Speichern (Formular zuklappen, 14b). */ onSaved?: () => void }) {
  const t = useTranslations('finance.closing.assembly');
  const fmt = useDateFormat();
  const router = useRouter();
  const result = step.facts.result;
  const initial = initialOf(result, data);
  const [v, setV] = useState<Values>(initial);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const feedback = useActionFeedback();
  const upload = useActionFeedback();
  // Nach dem Hochladen baut der Server neu, das Formular bleibt montiert: das neue Protokoll übernehmen, sonst hinge
  // der nächste Speichern-Aufruf es wieder ab (Schlussdurchsicht I1).
  const minutesId = data.minutes?.id ?? null;
  useEffect(() => {
    setV((s) => ({ ...s, minutes: data.minutes }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutesId]);

  if (status.yearStatus !== 'closed') return <p className="text-meta text-ink-2" data-testid="closing-body-assembly">{t('yearOpen')}</p>;
  // Ohne Recht wie bei den anderen Schritten (`noRight`): kein Formular, kein Protokoll ablegen — der Ergebnissatz
  // steht schon als `detail` darüber.
  if (!canConfirm) return <p className="text-meta text-muted-ink" data-testid="closing-body-assembly">{t('noRight')}</p>;

  const changed = [
    v.assemblyOn !== initial.assemblyOn,
    (v.minutes?.id ?? null) !== (initial.minutes?.id ?? null),
    v.accountsApproved !== initial.accountsApproved,
    v.dischargeMode !== initial.dischargeMode,
    v.collectiveOutcome !== initial.collectiveOutcome,
    ...data.persons.map((p) => v.discharges[p.contactId] !== initial.discharges[p.contactId]),
  ].filter(Boolean).length;

  const save = async () => {
    setPending(true);
    const outcome = await feedback.run(
      () =>
        saveAssemblyAction({
          fiscalYearId: status.fiscalYearId,
          assemblyOn: v.assemblyOn,
          // Nur senden, was sich geändert hat — sonst bleibt das Protokoll, wie es ist.
          ...((v.minutes?.id ?? null) !== (initial.minutes?.id ?? null) ? { minutesDocumentId: v.minutes?.id ?? null } : {}),
          accountsApproved: v.accountsApproved,
          dischargeMode: v.dischargeMode,
          collectiveOutcome: v.dischargeMode === 'collective' ? v.collectiveOutcome : null,
          discharges: v.dischargeMode === 'individual' ? data.persons.map((p) => ({ contactId: p.contactId, outcome: v.discharges[p.contactId] ?? null })) : [],
          ...(result ? { expectedVersion: result.version } : {}),
        }),
      { retry: () => void save() },
    );
    setPending(false);
    if (outcome.status !== 'success') return;
    onSaved?.();
    router.refresh();
  };

  const uploadMinutes = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('fiscalYearId', status.fiscalYearId);
    formData.append('file', file);
    const outcome = await upload.run(() => uploadMinutesAction(formData), { retry: () => void uploadMinutes(files) });
    setUploading(false);
    if (outcome.status === 'success') router.refresh();
  };

  const period = (p: AssemblyPerson) => {
    const since = p.since && p.since > status.startsOn ? p.since : null;
    const until = p.until && p.until < status.endsOn ? p.until : null;
    if (since && until) return t('between', { since: fmt.date(since), until: fmt.date(until) });
    if (until) return t('until', { date: fmt.date(until) });
    if (since) return t('since', { date: fmt.date(since) });
    return t('wholeYear');
  };

  const openNames = data.persons.filter((p) => v.discharges[p.contactId] === 'refused' || v.discharges[p.contactId] === 'postponed');
  const notice =
    v.dischargeMode === 'collective'
      ? v.collectiveOutcome === 'refused' || v.collectiveOutcome === 'postponed'
        ? t('openCollective', { outcome: t(`outcomes.${v.collectiveOutcome}`) })
        : null
      : openNames.length > 0
        ? t('open', { names: openNames.map((p) => p.name).join(', '), outcome: t(`outcomes.${v.discharges[openNames[0]!.contactId]!}`) })
        : null;

  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const segment = (id: string, value: DischargeOutcome | null, onChange: (o: DischargeOutcome) => void, labelledBy: string) => (
    <Segmented aria-labelledby={labelledBy} value={value ?? undefined} onValueChange={onChange} disabled={!canConfirm} options={OUTCOMES.map((o) => ({ value: o, label: t(`outcomes.${o}`), testId: `${id}-${o}` }))} testId={id} />
  );

  return (
    <FormCard
      as="form"
      data-testid="closing-body-assembly"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void save();
      }}
    >
      <FormCardBody>
        <div className="flex flex-col gap-4">
          <p className="text-meta text-ink-2">{t('intro')}</p>
          {/* V-8: Gremien führte das Ergebnis und ist ausgeschaltet — es gilt wieder von Hand; keine Sperre, nur der Hinweis. */}
          {step.facts.formerlyManaged ? (
            <div data-testid="closing-assembly-formerly-managed">
              <Notice level="hint">{t('formerlyManaged', { label: step.facts.formerlyManaged.label })}</Notice>
            </div>
          ) : null}
          <FormGrid>
            <FormField id="closing-assembly-date" label={t('date')} required error={fieldErrors.assemblyOn} size="s">
              <Input id="closing-assembly-date" type="date" value={v.assemblyOn} disabled={!canConfirm} onChange={(e) => setV({ ...v, assemblyOn: e.target.value })} />
            </FormField>
            {/* Hinweis, keine Sperre (Entscheidung c): Der Dienst nennt ihn zum gespeicherten Datum. */}
            {result?.warnings.includes('assemblyBeforeAuditReport') && result.auditReportFiledAt && v.assemblyOn === result.assemblyOn ? (
              <FormCell size="full" data-testid="closing-assembly-before-report">
                <Notice level="warn">{t('beforeAuditReport', { date: fmt.date(result.auditReportFiledAt) })}</Notice>
              </FormCell>
            ) : null}
            <FormCell size="l" className="flex flex-col gap-1.5">
              <DocumentPicker id="closing-assembly-minutes" name="minutesDocumentId" label={t('minutes')} value={v.minutes} onChange={(minutes) => setV({ ...v, minutes })} />
              <p className="text-hint text-muted-ink">{v.minutes ? t('minutesHint') : `${t('minutesNone')} · ${t('minutesHint')}`}</p>
              {result && canConfirm ? <ReceiptDrop onFiles={(files) => void uploadMinutes(files)} disabled={uploading} /> : <p className="text-hint text-muted-ink">{t('minutesAfterSave')}</p>}
              <RefusalNotice state={withUnplacedFieldErrors(upload.state, [])} />
            </FormCell>
          </FormGrid>
          <div className="flex flex-col gap-1.5">
            <Label id="closing-assembly-accounts">{t('accounts')}</Label>
            <Segmented
              className="self-start"
              aria-labelledby="closing-assembly-accounts"
              aria-describedby="closing-assembly-accounts-hint"
              value={v.accountsApproved ?? undefined}
              onValueChange={(accountsApproved) => setV({ ...v, accountsApproved })}
              disabled={!canConfirm}
              options={(['yes', 'no', 'notVoted'] as const).map((o) => ({ value: o, label: t(`accountsOptions.${o}`) }))}
              testId="closing-assembly-accounts"
            />
            {/* Schritt 11 verweist auf beide Berichte (Spec Teil J): „Jahresrechnung genehmigt“ meint die MV, der Bericht heißt auch so. */}
            <p id="closing-assembly-accounts-hint" className="text-hint text-muted-ink">
              {t.rich('accountsHint', {
                cash: (chunks) => (
                  <Link href={`/finance/reports/cashReport?year=${encodeURIComponent(status.fiscalYearId)}`} className="text-link underline-offset-2 hover:underline">
                    {chunks}
                  </Link>
                ),
                annual: (chunks) => (
                  <Link href={`/finance/reports/annualAccounts?year=${encodeURIComponent(status.fiscalYearId)}`} className="text-link underline-offset-2 hover:underline">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label id="closing-assembly-mode">{t('mode')}</Label>
            <Segmented className="self-start" aria-labelledby="closing-assembly-mode" aria-describedby="closing-assembly-mode-hint" value={v.dischargeMode} onValueChange={(dischargeMode) => setV({ ...v, dischargeMode })} disabled={!canConfirm} options={(['individual', 'collective'] as const).map((o) => ({ value: o, label: t(`modes.${o}`) }))} testId="closing-assembly-mode" />
            <p id="closing-assembly-mode-hint" className="text-hint text-muted-ink">
              {t('modeHint')}
            </p>
          </div>
          {v.dischargeMode === 'individual' ? (
            data.persons.length === 0 ? (
              <p className="text-meta text-muted-ink">{t('noPersons')}</p>
            ) : (
              <ul className="flex flex-col gap-3" data-testid="closing-assembly-persons">
                {data.persons.map((p) => (
                  <li key={p.contactId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5" data-testid="closing-assembly-person">
                    <span id={`closing-assembly-person-${p.contactId}`} className="min-w-0 text-body text-ink">
                      {t('person', { name: p.name, office: p.office ?? t('boardMember'), period: period(p) })}
                    </span>
                    {segment(`closing-assembly-discharge-${p.contactId}`, v.discharges[p.contactId] ?? null, (o) => setV({ ...v, discharges: { ...v.discharges, [p.contactId]: o } }), `closing-assembly-person-${p.contactId}`)}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
              <span id="closing-assembly-collective" className="text-body text-ink">
                {t('collective')}
              </span>
              {segment('closing-assembly-collective', v.collectiveOutcome, (o) => setV({ ...v, collectiveOutcome: o }), 'closing-assembly-collective')}
            </div>
          )}
          {notice ? (
            <div data-testid="closing-assembly-open">
              <Notice level="hint">{notice}</Notice>
            </div>
          ) : null}
        </div>
      </FormCardBody>
      {canConfirm ? <FormActionBar count={changed} onSave={() => void save()} onDiscard={() => setV(initial)} pending={pending} state={withUnplacedFieldErrors(feedback.state, ['assemblyOn'])} saveTestId="closing-assembly-save" /> : null}
    </FormCard>
  );
}
