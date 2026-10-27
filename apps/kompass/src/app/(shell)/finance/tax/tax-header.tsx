'use client';

import type { ReportFinalizeBlock, ReportStage, TaxPeriodView } from '@kompass/module-finance';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { FilterBar, frameFilter } from '@/components/filter-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { KeyLine } from '@/components/key-line';
import { PageHeader } from '@/components/page-header';
import { RecordActions } from '@/components/record-actions';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useFileDownload } from '@/lib/use-file-download';
import { FinalizeDialog } from '../reports/[key]/finalize-dialog';
import { TaxPeriodDialog } from './tax-period-dialog';
import type { DueSuggestions, TaxMe, TaxPeriodOption, TaxYear } from './types';

type DialogProps = { years: readonly TaxYear[]; defaults: { firstFiscalYearId: string; lastFiscalYearId: string } | null; latestPeriod?: string | null; dueSuggestions: DueSuggestions };

/**
 * Ohne Erklärungszeitraum (Board 13g): Kopf „Steuererklärung“ und `EmptyState` mit dem Satz, was ein Zeitraum ist;
 * „Erklärungszeitraum anlegen …“ nur mit `finance.periodClose`.
 */
export function TaxEmpty({ me, ...dialog }: DialogProps & { me: TaxMe }) {
  const t = useTranslations('finance.tax');
  const [open, setOpen] = useState(false);
  const create = me.canEdit ? (
    <Button type="button" onClick={() => setOpen(true)} data-testid="tax-period-create">
      {t('empty.create')}
    </Button>
  ) : undefined;
  return (
    <>
      <PageHeader title={t('title')} />
      <EmptyState title={t('empty.title')} text={t('empty.text')} action={create} />
      {me.canEdit ? <TaxPeriodDialog open={open} onOpenChange={setOpen} period={null} canPickDocument={me.canPickDocument} {...dialog} /> : null}
    </>
  );
}

/**
 * Kopf der Steuererklärung (Board 5a): „Steuererklärung {Zeitraum}“, Stufe der Werte (`reportStage`), Satz mit fehlenden
 * Angaben und Frist; primär „Festschreiben“ — gesperrt steht statt des Knopfs der Satz des Hemmnisses wie auf „Berichte“.
 * „Herunterladen“ in `more`, ⋯ mit „Neuer Erklärungszeitraum …“ und „Zeitraum bearbeiten …“.
 */
export function TaxHeader({
  period,
  stage,
  shortHash,
  generatedAt,
  finalizeBlock,
  missingCount,
  me,
  pdfHref,
  runningYear = null,
  ...dialog
}: DialogProps & {
  period: Pick<TaxPeriodView, 'id' | 'label' | 'dueOn' | 'filedOn' | 'firstFiscalYearId' | 'lastFiscalYearId' | 'requestedOn' | 'withTaxAdvisor' | 'yearsLocked' | 'version' | 'documents'>;
  stage: ReportStage;
  shortHash: string;
  generatedAt: string;
  finalizeBlock: ReportFinalizeBlock | null;
  missingCount: number;
  me: TaxMe;
  pdfHref: string;
  /** Das letzte Jahr des Zeitraums läuft noch: „{year} läuft noch.“ in der Kopfzeile statt neben den Knöpfen (16b). */
  runningYear?: string | null;
}) {
  const t = useTranslations('finance.tax');
  const tReports = useTranslations('finance.reports');
  const fmt = useDateFormat();
  const [finalizing, setFinalizing] = useState(false);
  const [dialog_, setDialog] = useState<'create' | 'edit' | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { busy, refusal, download } = useFileDownload({ forbidden: tReports('view.downloadRefused.forbidden'), notFound: tReports('view.downloadRefused.notFound'), failed: tReports('view.downloadRefused.failed') });

  const block = finalizeBlock;
  const running = block?.code === 'reportYearOpen' && runningYear ? runningYear : null;
  const blockedSentence =
    block === null || block.code === 'reportAlreadyFinal' || running
      ? null
      : block.code === 'reportGemIncomplete'
        ? t('header.blocked.missing', { count: Number(block.params.missing ?? 0) })
        : tReports.has(`view.blocked.${block.code}`)
          ? tReports(`view.blocked.${block.code}`, { year: String(block.params.designation ?? ''), accounts: String(block.params.accounts ?? ''), count: Number(block.params.count ?? 0) })
          : null;
  const finalizeShown = stage !== 'final' && me.canFinalize;
  // Der Knopf steht nur, wenn der Dienst nichts hemmt; sonst der Satz des Hemmnisses — im laufenden Jahr steht er schon
  // in der Kopfzeile (16b), dann steht hier nichts (Befund 23a: E7 hatte mit dem Satz auch die Sperre entfernt).
  const finalizable = block === null || block.code === 'reportAlreadyFinal';
  const actions = (
    <>
      {finalizeShown && finalizable ? (
        <Button type="button" onClick={() => setFinalizing(true)} data-testid="tax-finalize">
          {tReports('view.finalize')}
        </Button>
      ) : finalizeShown && blockedSentence ? (
        <span className="text-meta text-muted-ink" data-testid="tax-finalize-blocked">
          {blockedSentence}
        </span>
      ) : null}
      {me.canEdit ? (
        <RecordActions
          triggerRef={trigger}
          testId="tax-record-actions"
          actions={[
            { key: 'create', label: t('header.newPeriod'), kind: 'reversible', onSelect: () => setDialog('create'), testId: 'tax-period-new' },
            { key: 'edit', label: t('header.editPeriod'), kind: 'reversible', onSelect: () => setDialog('edit'), testId: 'tax-period-edit' },
          ]}
        />
      ) : null}
    </>
  );

  return (
    <>
      {/* `tax-header`: Kopf samt ⋯ als ein Ziel für Bildlauf und E2E (wie `tax-period-bar`). */}
      <div data-testid="tax-header">
        <PageHeader
          title={t('header.title', { period: period.label })}
          status={
            <StatusBadge tone={statusTone('reportStage', stage)} dot>
              {tReports(`stage.${stage}`)}
            </StatusBadge>
          }
          description={
            <>
              <span className="block">
                {[t('header.purpose'), running ? tReports('view.running', { year: running }) : null, missingCount > 0 ? t('header.missing', { count: missingCount }) : null, period.filedOn ? t('header.filed', { date: fmt.date(period.filedOn) }) : t('header.due', { date: fmt.date(period.dueOn) })].filter(Boolean).join(' ')}
              </span>
              <KeyLine className="mt-1">{tReports('view.generated', { date: fmt.dateTime(generatedAt), hash: shortHash })}</KeyLine>
            </>
          }
          more={[{ key: 'download', label: tReports('view.download'), icon: <Download className="size-4" aria-hidden />, disabled: busy, onSelect: () => void download(`${pdfHref}&download=1`, 'anlage-gem.pdf'), testId: 'tax-download' }]}
          actions={actions}
        />
      </div>
      <RefusalNotice action state={refusal} />
      {finalizeShown && finalizable ? <FinalizeDialog open={finalizing} onOpenChange={setFinalizing} reportKey="taxReturnGem" params={{ taxPeriodId: period.id }} shortHash={shortHash} title={t('header.title', { period: period.label })} /> : null}
      {me.canEdit ? (
        <TaxPeriodDialog open={dialog_ !== null} onOpenChange={(o) => (o ? undefined : setDialog(null))} period={dialog_ === 'edit' ? period : null} canPickDocument={me.canPickDocument} finalFocus={trigger} {...dialog} />
      ) : null}
    </>
  );
}

/** Der Zeitraum als Rahmen (13g, MUSTER § L): neuester zuerst, jede Option mit Zustand; schreibt `?period=`. */
export function TaxPeriodBar({ periods, periodId, lineCount }: { periods: readonly TaxPeriodOption[]; periodId: string; lineCount: number }) {
  const t = useTranslations('finance.tax');
  const fmt = useDateFormat();
  const router = useRouter();
  const [, startNavigation] = useTransition();
  const go = (value: string) => startNavigation(() => router.replace(`/finance/tax?period=${encodeURIComponent(value)}`));
  const optionLabel = (p: TaxPeriodOption) =>
    p.state === 'assessed' && p.noticeOn
      ? t('bar.assessed', { period: p.label, date: fmt.date(p.noticeOn) })
      : p.filedOn
        ? t('bar.filed', { period: p.label, date: fmt.date(p.filedOn) })
        : t('bar.open', { period: p.label, date: fmt.date(p.dueOn) });
  return (
    <FilterBar
      filters={[frameFilter({ key: 'period', label: t('bar.label'), value: periodId, options: periods.map((p) => ({ value: p.id, label: optionLabel(p) })), onChange: go, testId: 'tax-period-select' })]}
      onApply={(values) => (values.period ? go(values.period) : undefined)}
      count={{ shown: lineCount, total: lineCount, noun: { one: t('bar.noun.one'), other: t('bar.noun.other'), dative: t('bar.noun.dative') } }}
      onReset={() => undefined}
      testId="tax-period-bar"
    />
  );
}
