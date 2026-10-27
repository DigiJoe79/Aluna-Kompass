'use client';

import type { ClosingStatus } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { PageHeader } from '@/components/page-header';
import { RecordActions, type RecordAction } from '@/components/record-actions';
import { HandoverStartDialog } from './handover-start-dialog';
import { ReopenDialog, type ReopenPreview } from './reopen-dialog';
import { taxReturnSettled } from './step-detail';

/**
 * Kopf des Jahresabschlusses (Board 3a): Titel „Jahresabschluss <Jahr>“, darunter der Stand als Satz ohne Kasten
 * und Farbe — „5 von 12 erledigt. Als Nächstes: …“, vor dem Jahresende „beginnt nach dem …“. Im ⋯: „Amtsübergabe
 * beginnen …“ (Recht `finance.setup`) und „Jahr wiederöffnen …“ (abgeschlossen, Recht `finance.periodClose`).
 */
export function ClosingHeader({ status, reopen, handoverStart = null, onStartHandover }: { status: ClosingStatus; reopen: ReopenPreview | null; /** Für „Amtsübergabe beginnen …“: heute und ob Kontakte angelegt werden dürfen. */ handoverStart?: { today: string; canCreateContact: boolean } | null; onStartHandover?: () => void }) {
  const t = useTranslations('finance.closing');
  const fmt = useDateFormat();
  const more = useRef<HTMLButtonElement>(null);
  const [reopening, setReopening] = useState(false);
  const [starting, setStarting] = useState(false);
  const startHandover = onStartHandover ?? (handoverStart ? () => setStarting(true) : undefined);
  const total = status.steps.length;

  const assembly = status.steps.find((s) => s.key === 'assembly')?.facts;
  // Offen ist nur noch die Entlastung (vertagt, verweigert): Namen und Zustand aus dem Stand (Board 14b).
  const parkedAssembly = status.next === 'assembly' && assembly?.key === 'assembly' && assembly.result !== null ? assembly : null;
  // E11: Ist die Steuererklärung erledigt und fehlt nur die USt-Jahreserklärung, nennt der Kopf genau die (nicht „Steuererklärung klären“).
  const taxStep = status.steps.find((s) => s.key === 'taxReturn');
  const vatOnlyNext = status.next === 'taxReturn' && taxStep && taxStep.facts.key === 'taxReturn' && taxStep.facts.vat && taxStep.facts.vat.filedOn === null && taxReturnSettled(taxStep) ? taxStep.facts.vat.calendarYear : null;
  const outcome = (o: 'granted' | 'refused' | 'postponed' | null) => (o ? t(`assembly.outcomes.${o}`) : t('assembly.resultUndecided'));
  const description = !status.ended
    ? t('head.notEnded', { year: status.designation, date: fmt.date(status.endsOn) })
    : parkedAssembly
      ? parkedAssembly.result!.dischargeMode === 'collective'
        ? t('head.openDischargeCollective', { done: status.doneCount, total, outcome: outcome(parkedAssembly.result!.collectiveOutcome) })
        : t('head.openDischarge', { done: status.doneCount, total, persons: parkedAssembly.pending.map((p) => t('head.openPerson', { name: p.name, outcome: outcome(p.outcome) })).join('; ') })
    : status.next === null
      ? t('head.allDone', { total })
      : t('head.progress', { done: status.doneCount, total, next: followUpNext(status) === 'unchanged' ? t('steps.auditReport.nextFollowUp') : followUpNext(status) === 'changed' ? t('steps.auditReport.nextFollowUpChanged') : cashToConfirm(status) ? t('steps.cash.nextConfirm') : vatOnlyNext ? t('steps.taxReturn.nextVat', { year: String(vatOnlyNext) }) : t(`steps.${status.next}.next`) });

  const canReopen = status.yearStatus === 'closed' && status.me.canClose && reopen !== null;
  const actions: RecordAction[] = [
    { key: 'handover', label: t('more.handover'), kind: 'reversible', onSelect: () => startHandover?.(), hidden: !status.me.canHandover || !startHandover, testId: 'closing-handover-start' },
    { key: 'reopen', label: t('more.reopen'), kind: 'undoing', onSelect: () => setReopening(true), hidden: !canReopen, testId: 'closing-reopen' },
  ];

  return (
    <>
      <PageHeader title={t('title', { year: status.designation })} description={<span data-testid="closing-head">{description}</span>} actions={<RecordActions triggerRef={more} actions={actions} testId="closing-more" />} />
      {handoverStart && status.me.canHandover ? <HandoverStartDialog open={starting} onOpenChange={setStarting} today={handoverStart.today} canCreateContact={handoverStart.canCreateContact} finalFocus={more} /> : null}
      {canReopen ? <ReopenDialog open={reopening} onOpenChange={setReopening} fiscalYearId={status.fiscalYearId} year={status.designation} preview={reopen!} finalFocus={more} /> : null}
    </>
  );
}

/** Schritt 2 ist der nächste, und jede offene Kasse ist rückgerechnet: Es bleibt nur das Bestätigen (Board 14a). */
function cashToConfirm(status: ClosingStatus): boolean {
  const facts = status.steps.find((s) => s.key === 'cash')?.facts;
  if (status.next !== 'cash' || facts?.key !== 'cash') return false;
  const open = facts.accounts.filter((a) => a.count === null && a.confirmation === null);
  return open.length > 0 && open.every((a) => a.later !== null && a.later.differenceCents === 0);
}

/**
 * Ist Schritt 10 der nächste und die Nachprüfung offen: ohne geänderte Buchung „Nachprüfung bestätigen“ mit dem Verb
 * des Knopfs (Board 14d B), sonst „Nachprüfung klären“ (Befund 3).
 */
function followUpNext(status: ClosingStatus): 'unchanged' | 'changed' | null {
  const facts = status.steps.find((s) => s.key === 'auditReport')?.facts;
  if (status.next !== 'auditReport' || facts?.key !== 'auditReport' || !facts.followUpOpen) return null;
  return facts.changedEntries === 0 ? 'unchanged' : 'changed';
}
