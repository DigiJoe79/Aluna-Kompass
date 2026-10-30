'use client';

import type { ClosingStatus, ClosingStepKey, ClosingStepView } from '@kompass/module-finance';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { FixedValue } from '@/components/fixed-value';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { Notice } from '@/components/notice';
import { Steps, type Step } from '@/components/steps';
import { CloseYearDialog } from './close-dialog';
import { StepConfirmDialog } from './confirm-dialog';
import { factsAre, type FactsOf } from './step-body';
import { Button } from '@/components/ui/button';
import { useStepDetail, taxReturnSettled, taxReturnStateOf } from './step-detail';
import { useStepLabel } from './step-label';
import type { AuditPackageView } from '@/lib/finance/audit-package-view';
import { AssemblyStep, type AssemblyData } from './steps/assembly';
import { AuditPackageStep } from './steps/audit-package';
import { AuditReportStep } from './steps/audit-report';
import { CashStep } from './steps/cash';
import { CloseStep } from './steps/close';
import { FundsUseStep } from './steps/funds-use';
import { ConfirmationsStep } from './steps/confirmations';
import { ListsStep } from './steps/lists';
import { OpenItemsStep } from './steps/open-items';
import { PurposesStep } from './steps/purposes';
import { ReservesStep } from './steps/reserves';
import { StatementsStep } from './steps/statements';
import { TaxReturnStep } from './steps/tax-return';

const GROUPS = ['before', 'close', 'after'] as const;

/**
 * Die zwölf Schritte, über der Grenze dreizehn (Board 3a–3c; Schritt 13 Mittelverwendung, Plan U2): wiedergeöffnet als `Notice warn` über den Schritten, darunter je Amtsübergabe des
 * Jahres eine Zeile, dann `Steps compact` in drei Gruppen. Nur der Schritt `next` ist aktiv und trägt seinen Körper;
 * vor dem Jahresende ist keiner aktiv. Alle erledigt: „Fertig.“ mit Ergebnis, die Schritte zugeklappt.
 */
export function ClosingSteps({
  status,
  names,
  canWrite = false,
  packageRun = null,
  nextDesignation,
  assembly = { persons: [], minutes: null },
  today = '',
  canFileVat = false,
  canFinalize = false,
}: {
  status: ClosingStatus;
  names: Readonly<Record<string, string>>;
  /** `finance.entriesWrite`: Auszüge ablegen. */
  canWrite?: boolean;
  /** Schritt 9: der Stand des Prüfpaket-Laufs (nur im abgeschlossenen Jahr). */
  packageRun?: AuditPackageView | null;
  /** Bezeichnung des Folgejahres für die Nachprüfung (Board 10c). */
  nextDesignation?: string;
  /** Schritt 11: Vorstandsmitglieder des Jahres und das abgelegte Protokoll. */
  assembly?: AssemblyData;
  /** Heute im Verein und `finance.periodClose`: „Abgabe eintragen …“ in Schritt 12 (Designer Runde 8, 17e). */
  today?: string;
  canFileVat?: boolean;
  /** `finance.reportsFinalize`: „Festschreiben …“ in Schritt 13 (Mittelverwendung, Plan U2). */
  canFinalize?: boolean;
}) {
  const t = useTranslations('finance.closing');
  const fmt = useDateFormat();
  const label = useStepLabel();
  const detail = useStepDetail(status, names);
  const [confirming, setConfirming] = useState<ClosingStepKey | null>(null);
  const [closing, setClosing] = useState(false);
  const canConfirm = status.me.canConfirm;

  const body = (step: ClosingStepView): ReactNode => {
    const open = () => (step.key === 'close' ? setClosing(true) : setConfirming(step.key));
    const common = { status, canConfirm, onConfirm: open };
    if (factsAre(step, 'statements')) return <StatementsStep step={step} {...common} names={names} canWrite={canWrite} />;
    if (factsAre(step, 'cash')) return <CashStep step={step} {...common} />;
    if (factsAre(step, 'lists')) return <ListsStep step={step} {...common} />;
    if (factsAre(step, 'openItems')) return <OpenItemsStep step={step} {...common} />;
    if (factsAre(step, 'purposes')) return <PurposesStep step={step} {...common} />;
    if (factsAre(step, 'reserves')) return <ReservesStep step={step} {...common} />;
    if (factsAre(step, 'confirmations')) return <ConfirmationsStep step={step} {...common} />;
    if (factsAre(step, 'close')) return <CloseStep step={step} {...common} />;
    if (factsAre(step, 'auditPackage')) return <AuditPackageStep step={step} {...common} packageRun={packageRun} />;
    if (factsAre(step, 'auditReport')) return <AuditReportStep step={step} {...common} nextDesignation={nextDesignation ?? t('nextYear')} />;
    if (factsAre(step, 'assembly')) return <AssemblyStep step={step} {...common} data={assembly} />;
    if (factsAre(step, 'taxReturn')) return <TaxReturnStep step={step} {...common} today={today} canFileVat={canFileVat} />;
    if (factsAre(step, 'fundsUse')) return <FundsUseStep step={step} {...common} canFinalize={canFinalize} />;
    return null;
  };

  const steps: Step[] = status.steps.map((s) => {
    // Schritt 11 mit gespeichertem Ergebnis (verweigert, vertagt) ist nie aktiv: Er trägt seinen Satz und den Link
    // „Ergebnis nachtragen“, das Formular erst auf Klick (Board 14b). Nur der aktive Schritt hat einen Körper.
    // Führt Gremien das Ergebnis (G7), ist Schritt 11 nie aktiv und hat kein Formular: darunter steht, wo es geführt wird.
    const managed = s.facts.key === 'assembly' ? (s.facts.result?.managed ?? null) : null;
    const parked = status.ended && !s.done && s.facts.key === 'assembly' && s.facts.result !== null;
    const active = status.ended && s.key === status.next && !parked;
    return {
      key: s.key,
      label: label(s.key, status),
      state: s.done ? 'done' : active ? 'active' : 'todo',
      // Erledigt: das Ergebnis. Offen vor dem Abschluss: der Stand (Befund 8). Der aktive Schritt beginnt mit dem Satz
      // seines Körpers. Schritt 11 offen mit Ergebnis: der Satz als Unterzeile.
      // Schritt 12 aktiv, die Steuererklärung schon erledigt (Befund 34 a): oben ihr Ergebnis, im Körper nur die USt.
      detail: s.done || parked || (active && s.key === 'assembly') || (active && taxReturnSettled(s)) || (!active && s.group === 'before') ? detail(s) : undefined,
      below: managed ? <ManagedAssembly managed={managed} refusedAfterGranted={s.facts.key === 'assembly' && !!s.facts.result?.warnings.includes('dischargeRefusedAfterGranted')} /> : active ? body(s) : parked && factsAre(s, 'assembly') ? <ParkedAssembly step={s} status={status} canConfirm={canConfirm} data={assembly} /> : undefined,
    };
  });
  const groups = GROUPS.map((g) => ({ label: t(`groups.${g}`), keys: status.steps.filter((s) => s.group === g).map((s) => s.key) }));

  const repeat = status.toRepeat.map((key) => `${status.steps.find((s) => s.key === key)!.number} ${label(key, status)}`).join(', ');
  const confirmStep = confirming ? status.steps.find((s) => s.key === confirming)! : null;
  // Schritt 10 bestätigt nur die Nachprüfung ohne geänderte Buchung: ohne Begründung (Board 14d B).
  const unchangedFollowUp = confirmStep?.facts.key === 'auditReport' ? confirmStep.facts : null;

  return (
    <div className="flex flex-col gap-4">
      {status.reopened ? (
        <Notice level="warn" testId="closing-reopened">
          <span className="block">{t('reopened', { date: fmt.date(status.reopened.at), name: names[status.reopened.byUserId] ?? t('system'), reason: status.reopened.reason })}</span>
          {repeat ? <span className="block">{t('toRepeat', { steps: repeat })}</span> : null}
        </Notice>
      ) : null}
      {status.handovers.filter((h) => h.state !== 'cancelled').length > 0 ? (
        <ul className="flex flex-col gap-1">
          {status.handovers
            .filter((h) => h.state !== 'cancelled')
            .map((h) => (
              <li key={h.id}>
                {/* Der Pfeil folgt dem letzten Wort und bricht mit ihm um (284 Telefon): Fließtext, kein Flex. */}
                <Link href={`/finance/closing/handover/${encodeURIComponent(h.id)}`} className="text-meta text-link underline-offset-2 hover:underline" data-testid="closing-handover-line">
                  {t('handoverLine', { date: fmt.date(h.handoverOn), from: h.fromName, to: h.toName })}
                  {'\u00a0'}
                  <ChevronRight className="inline size-3.5 align-middle" aria-hidden />
                </Link>
              </li>
            ))}
        </ul>
      ) : null}
      <Steps density="compact" steps={steps} groups={groups} label={t('stepsLabel')} done={<FinishedSentence status={status} />} collapsedWhenDone={{ label: t('showSteps') }} testId="closing-steps" />
      {confirmStep ? (
        <StepConfirmDialog
          open={confirming !== null}
          onOpenChange={(o) => (o ? undefined : setConfirming(null))}
          fiscalYearId={status.fiscalYearId}
          step={confirmStep.key}
          stepLabel={label(confirmStep.key, status)}
          year={status.designation}
          description={unchangedFollowUp ? t('confirmDialog.followUpUnchanged.description', { year: status.designation, date: fmt.date(unchangedFollowUp.filedAt) }) : t(`confirmDialog.description.${confirmStep.key as 'lists'}`, { date: fmt.date(status.endsOn) })}
          suggestion={confirmStep.key === 'taxReturn' ? t('taxReturn.suggestion', { year: status.designation }) : undefined}
          withoutNote={unchangedFollowUp ? { title: t('confirmDialog.followUpUnchanged.title', { year: status.designation }) } : undefined}
        />
      ) : null}
      {status.me.canClose ? <CloseYearDialog open={closing} onOpenChange={setClosing} fiscalYearId={status.fiscalYearId} year={status.designation} /> : null}
    </div>
  );
}

/** Schritt 11, wenn Gremien das Ergebnis führt (G7, Spec Gremien § 8.1): ein fester Wert mit Link zur Sitzung, kein Formular. */
function ManagedAssembly({ managed, refusedAfterGranted }: { managed: { label: string; href: string }; refusedAfterGranted: boolean }) {
  const ta = useTranslations('finance.closing.assembly');
  return (
    <FormGrid>
      <FixedValue id="closing-assembly-managed" label={ta('managed.label')} value={managed.label} href={managed.href} reason={ta('managed.reason')} size="l" testId="closing-assembly-managed" />
      {refusedAfterGranted ? (
        <FormCell size="full">
          <Notice level="warn">{ta('managed.refusedAfterGranted')}</Notice>
        </FormCell>
      ) : null}
    </FormGrid>
  );
}

/**
 * Schritt 11 vertagt oder verweigert (Board 14b): „Ergebnis nachtragen“ ohne Auslassungspunkte, weil kein Dialog folgt,
 * klappt das Formular aus 13d vorbelegt an der Stelle auf; Speichern klappt es wieder zu.
 */
function ParkedAssembly({ step, status, canConfirm, data }: { step: ClosingStepView<FactsOf<'assembly'>>; status: ClosingStatus; canConfirm: boolean; data: AssemblyData }) {
  const ta = useTranslations('finance.closing.assembly');
  const [open, setOpen] = useState(false);
  if (!canConfirm) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <Button type="button" variant="link" size="sm" className="h-auto w-fit p-0" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="closing-assembly-fill-in">
        {ta('fillIn')}
      </Button>
      {open ? <AssemblyStep step={step} status={status} canConfirm={canConfirm} onConfirm={() => undefined} data={data} onSaved={() => setOpen(false)} /> : null}
    </div>
  );
}

/** „Fertig.“ (Board 3c): geprüft und festgeschrieben, die Entlastung der MV, die Steuererklärung. */
function FinishedSentence({ status }: { status: ClosingStatus }) {
  const tf = useTranslations('finance.closing.finished');
  const fmt = useDateFormat();
  const pkg = status.steps.find((s) => s.key === 'auditPackage')?.facts;
  const assembly = status.steps.find((s) => s.key === 'assembly')?.facts;
  const audited = !(pkg?.key === 'auditPackage' && pkg.skippedBy !== null);
  const parts = [audited ? tf('audited', { year: status.designation }) : tf('notAudited', { year: status.designation })];
  if (assembly?.key === 'assembly' && assembly.result) parts.push(tf('assembly', { date: fmt.date(assembly.result.assemblyOn) }));
  // Der Stand von Schritt 12 aus derselben Quelle (Designer Runde 7, 294).
  const tax = status.steps.find((s) => s.key === 'taxReturn')?.facts;
  const taxFacts = tax?.key === 'taxReturn' ? tax : undefined;
  const period = taxFacts?.period;
  const state = taxReturnStateOf(taxFacts);
  parts.push(
    state === 'notDue' || !period
      ? tf('taxNotDue', { year: status.designation })
      : state === 'notice'
        ? tf('taxNotice', { period: period.label, date: fmt.date(period.notice!.noticeOn) })
        : state === 'filed'
          ? tf('taxFiled', { period: period.label })
          : state === 'partOf'
            ? tf('taxPartOf', { period: period.label, last: period.last })
            : tf('taxDue', { period: period.label, date: fmt.date(period.dueOn) }),
  );
  // Befund 34 a: Eine fällige USt-Jahreserklärung gehört zur Erledigung von Schritt 12 — „Fertig.“ nennt sie mit.
  if (taxFacts?.vat?.filedOn) parts.push(tf('vatFiled', { year: String(taxFacts.vat.calendarYear), date: fmt.date(taxFacts.vat.filedOn) }));
  return <span data-testid="closing-finished">{parts.join(' ')}</span>;
}
