'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { ChoiceCards } from '@/components/choice-cards';
import { useDateFormat } from '@/components/date-format-provider';
import { Button, buttonVariants } from '@/components/ui/button';
import { ReleaseDialog } from '../../reports/release-dialog';
import { ScanDialog } from '../../audit/scan-dialog';
import { CarryOverDialog } from '../carry-over-dialog';
import type { ClosingStepBody } from '../step-body';
import { ConfirmRow } from './confirm-row';

const link = 'text-link underline-offset-2 hover:underline';

/**
 * Schritt 10 „Prüfbericht“ (Board 10c, 11b, 13c). Ohne Nachprüfung: kein Prüfbericht → Weg zur Kassenprüfung und
 * „Freigeben …“; fehlende Auszüge → Satz mit Link auf Schritt 1; sonst wie viele Berichte der MV festgeschrieben sind.
 * Nach dem Wiederöffnen heißt er „Nachprüfung“: vor der MV nur der Nachtrag, nach der MV zwei `ChoiceCards` ohne
 * Vorwahl (Joe 2026-10-24) — „Bestätigen …“ erst nach der Wahl „In das Folgejahr übernehmen“. Ohne geänderte
 * Buchung keine Wahl: der Satz, dass der Prüfbericht weiter gilt, und „Bestätigen …“ (Befund 3).
 */
/** Schritt 12 sagt, ob die Steuererklärung des Jahres abgegeben ist — dieselbe Quelle wie § 153 AO beim Wiederöffnen. */
function taxReturnFiledOf(status: ClosingStepBody<'auditReport'>['status']): boolean {
  const facts = status.steps.find((s) => s.key === 'taxReturn')?.facts;
  return facts?.key === 'taxReturn' && !!facts.period?.filedOn;
}

export function AuditReportStep({ step, status, canConfirm, onConfirm, nextDesignation }: ClosingStepBody<'auditReport'> & { nextDesignation: string }) {
  const t = useTranslations('finance.closing.auditReport');
  const c = useTranslations('finance.closing');
  const fmt = useDateFormat();
  const f = step.facts;
  const [releasing, setReleasing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [carrying, setCarrying] = useState(false);
  const [choice, setChoice] = useState<'carryOver' | 'addendum' | ''>('');
  const audit = `/finance/audit?year=${encodeURIComponent(status.fiscalYearId)}`;
  const canClose = status.me.canClose;

  // Nachprüfung ohne geänderte Buchung (Befund 3): keine Wahl, der Prüfbericht gilt weiter — nur bestätigen.
  if (f.followUpOpen && f.changedEntries === 0) {
    // „Seit der Prüfung am …“: der Tag, an dem der Bericht abgelegt wurde; ohne ihn der Prüfstand.
    const since = f.filedAt ?? f.baselineAt;
    return (
      <div className="flex flex-col gap-2.5" data-testid="closing-body-auditReport" data-follow-up>
        <p className="text-meta text-ink-2">{since ? t('followUp.unchanged', { date: fmt.date(since) }) : t('followUp.unchangedNoDate')}</p>
        <ConfirmRow canConfirm={canConfirm} confirmable={step.confirmable} onConfirm={onConfirm} />
      </div>
    );
  }

  if (f.followUpOpen) {
    const addendum = (
      <div className="flex flex-col gap-2.5" data-testid="closing-addendum">
        <p className="text-meta text-ink-2">{t('followUp.beforeAssembly')}</p>
        {f.followUpReadyToSign && f.followUpReportId && canClose ? (
          <div>
            <Button type="button" onClick={() => setScanning(true)} data-testid="closing-addendum-file">
              {t('followUp.fileAddendum')}
            </Button>
          </div>
        ) : (
          <p className="text-meta text-ink-2">
            {t('followUp.writeOnAudit')}{' '}
            <Link href={audit} className={link}>
              {c('auditPackage.toAudit')}
            </Link>
          </p>
        )}
      </div>
    );
    return (
      <div className="flex flex-col gap-3" data-testid="closing-body-auditReport" data-follow-up>
        <p className="text-meta text-ink-2">
          {f.baselineAt ? t('followUp.changed', { date: fmt.date(f.baselineAt), count: f.changedEntries }) : t('followUp.changedNoDate', { count: f.changedEntries })}{' '}
          <Link href={`/finance/audit/journal?year=${encodeURIComponent(status.fiscalYearId)}`} className={link}>
            {t('followUp.toPackage')}
          </Link>
        </p>
        {f.afterAssembly ? (
          <>
            <ChoiceCards
              mode="choice"
              name="closing-follow-up"
              legend={t('followUp.choice')}
              value={choice}
              onSelect={(v) => setChoice(v as 'carryOver' | 'addendum')}
              options={[
                { value: 'carryOver', label: t('followUp.carryOver'), description: t('followUp.carryOverHint', { next: nextDesignation }) },
                { value: 'addendum', label: t('followUp.addendum'), description: t('followUp.addendumHint') },
              ]}
            />
            <p className="text-meta text-muted-ink">{t('followUp.choiceHint')}</p>
            {choice === 'carryOver' ? (
              canClose ? (
                <div>
                  <Button type="button" onClick={() => setCarrying(true)} data-testid="closing-carry-over">
                    {c('confirm')}
                  </Button>
                </div>
              ) : (
                <p className="text-meta text-muted-ink">{c('noRight')}</p>
              )
            ) : null}
            {choice === 'addendum' ? addendum : null}
          </>
        ) : (
          addendum
        )}
        {f.followUpReportId ? <ScanDialog open={scanning} onOpenChange={setScanning} target={{ reportId: f.followUpReportId }} auditors={[]} /> : null}
        {canClose ? <CarryOverDialog open={carrying} onOpenChange={setCarrying} fiscalYearId={status.fiscalYearId} year={status.designation} next={nextDesignation} taxReturnFiled={taxReturnFiledOf(status)} /> : null}
      </div>
    );
  }

  if (!f.release) {
    return (
      <div className="flex flex-col gap-2.5" data-testid="closing-body-auditReport">
        <p className="text-meta text-ink-2">{t('missing')}</p>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link href={audit} className={buttonVariants({ variant: 'outline' })}>
            {c('auditPackage.toAudit')}
          </Link>
          {canClose ? (
            <Button type="button" variant="outline" onClick={() => setReleasing(true)} data-testid="closing-release">
              {t('release')}
            </Button>
          ) : null}
        </div>
        {canClose ? <ReleaseDialog open={releasing} onOpenChange={setReleasing} year={{ id: status.fiscalYearId, designation: status.designation }} current={null} /> : null}
      </div>
    );
  }

  if (f.statementsMissing.length > 0) {
    return (
      <div className="flex flex-col gap-2.5" data-testid="closing-body-auditReport">
        <p className="text-meta text-ink-2" data-testid="closing-statements-missing">
          {f.statementsMissing.length === 1 ? t('statementOne', { account: f.statementsMissing[0]!.name, date: fmt.date(status.endsOn) }) : t('statementMany', { count: f.statementsMissing.length, date: fmt.date(status.endsOn) })}{' '}
          <Link href="#step-statements" className={link}>
            {t('toStatements')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5" data-testid="closing-body-auditReport">
      <p className="text-meta text-ink-2">{t('assembly', { done: f.assemblyReports.done, total: f.assemblyReports.total })}</p>
      <div>
        <Link href={`/finance/reports?year=${encodeURIComponent(status.fiscalYearId)}`} className={buttonVariants({ variant: 'outline' })} data-testid="closing-finalize">
          {t('finalize')}
        </Link>
      </div>
    </div>
  );
}
