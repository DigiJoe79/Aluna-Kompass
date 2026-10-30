'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';
import { FinalizeDialog } from '../../reports/[key]/finalize-dialog';
import type { ClosingStepBody } from '../step-body';

/** Sperren mit eigenem Satz unter `finance.reports.view.blocked` (wie `ReportView`). */
const BLOCKED_SENTENCES: readonly string[] = ['reportYearOpen', 'reportNotReleased', 'reportProbeFails', 'reportStatementsMissing'];

/**
 * Schritt 13 „Mittelverwendung festschreiben“ (Plan U2 Task 4; nur über der Grenze, das entscheidet der Dienst): Satz
 * mit Einnahmen, Grenze und Stufe, darunter „Zur Mittelverwendung“ und — in der Prüffassung und mit
 * `finance.reportsFinalize` — „Festschreiben …“ mit dem Dialog der Berichtsseite; ist es gesperrt, steht der Grund da. Nicht bestätigbar: erledigt ist er mit
 * der festgeschriebenen Fassung.
 */
export function FundsUseStep({ step, status, canFinalize }: ClosingStepBody<'fundsUse'> & { canFinalize: boolean }) {
  const t = useTranslations('finance.closing.fundsUse');
  const tReports = useTranslations('finance.reports');
  const [finalizing, setFinalizing] = useState(false);
  const f = step.facts;
  const params = { fiscalYearId: status.fiscalYearId };
  const block = f.finalizeBlock;
  const finalizeShown = canFinalize && f.stage === 'review' && block === null;
  // Gesperrt (etwa: Auszug zum Stichtag fehlt) nennt der Schritt den Grund vorher, wie der Kopf des Berichts — kein Knopf,
  // der erst nach dem Bestätigen abgelehnt würde.
  const blocked = f.stage !== 'final' && block && BLOCKED_SENTENCES.includes(block.code) ? tReports(`view.blocked.${block.code}`, { year: status.designation, accounts: String(block.params.accounts ?? ''), count: Number(block.params.count ?? 0) }) : null;
  return (
    <div className="flex flex-col gap-2.5" data-testid="closing-body-fundsUse">
      <p className="text-meta text-ink-2">{t('sentence', { year: status.designation, revenue: formatEuro(f.revenueCents), limit: f.limitCents === null ? '' : formatEuro(f.limitCents), stage: tReports(`stage.${f.stage}`), noLimit: f.limitCents === null ? 'yes' : 'no' })}</p>
      {blocked ? (
        <p className="text-meta text-ink-2" data-testid="closing-funds-use-blocked">
          {blocked}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/finance/fund-use?year=${encodeURIComponent(status.fiscalYearId)}`} className={buttonVariants({ variant: 'outline' })}>
          {t('toPage')}
        </Link>
        {finalizeShown ? (
          <Button type="button" onClick={() => setFinalizing(true)} data-testid="closing-funds-use-finalize">
            {t('finalize')}
          </Button>
        ) : null}
      </div>
      {finalizeShown ? <FinalizeDialog open={finalizing} onOpenChange={setFinalizing} reportKey="fundsUse" params={params} shortHash={f.shortHash} title={`${tReports('fundsUse.title')} ${status.designation}`} /> : null}
    </div>
  );
}
