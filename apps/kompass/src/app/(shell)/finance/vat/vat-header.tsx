'use client';

import type { ReportFinalizeBlock, ReportStage } from '@kompass/module-finance';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { FilterBar, frameFilter } from '@/components/filter-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { KeyLine } from '@/components/key-line';
import { PageHeader } from '@/components/page-header';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useFileDownload } from '@/lib/use-file-download';
import { FinalizeDialog } from '../reports/[key]/finalize-dialog';

/**
 * Kopf der Voranmeldung (Board 8a/8b, Muster `TaxHeader` 16b): „Umsatzsteuer-Voranmeldung {Zeitraum}“, Stufe der Werte
 * bzw. „Berichtigung offen“, der Satz zu Abgabe und Zahlung, Stand in Mono; „Festschreiben“ primär — gesperrt steht
 * der Satz des Hemmnisses (vor Ende des Zeitraums); „Herunterladen“ in `more`. Festgeschrieben nennt die Mono-Zeile die
 * Fassung aus der Akte wie 16a (Designer Runde 8, 9b); ist die Frist verstrichen, sagt es der Satz (340).
 */
export function VatHeader({
  periodKey,
  periodLabel,
  stage,
  amendmentDue,
  dueOn,
  filedOn,
  shortHash,
  generatedAt,
  finalVersion = null,
  today,
  finalizeBlock,
  canFinalize,
  pdfHref,
}: {
  periodKey: string;
  periodLabel: string;
  stage: ReportStage;
  amendmentDue: boolean;
  dueOn: string | null;
  filedOn: string | null;
  shortHash: string;
  generatedAt: string;
  /** Festgeschrieben: die geltende Fassung aus der Akte (9b, wie 16a) statt „erzeugt heute“. */
  finalVersion?: { finalizedAt: string; shortHash: string; documentNumber: string } | null;
  /** Heute im Verein, für „Frist … verstrichen“ (340). */
  today: string;
  finalizeBlock: ReportFinalizeBlock | null;
  canFinalize: boolean;
  pdfHref: string;
}) {
  const t = useTranslations('finance.vat');
  const tReports = useTranslations('finance.reports');
  const tErrors = useTranslations('finance.errors');
  const fmt = useDateFormat();
  const [finalizing, setFinalizing] = useState(false);
  const { busy, refusal, download } = useFileDownload({ forbidden: tReports('view.downloadRefused.forbidden'), notFound: tReports('view.downloadRefused.notFound'), failed: tReports('view.downloadRefused.failed') });

  const finalizable = finalizeBlock === null || finalizeBlock.code === 'reportAlreadyFinal';
  const finalizeShown = stage !== 'final' && canFinalize;
  const blockedSentence = finalizeBlock?.code === 'reportPeriodOpen' ? tErrors('reportPeriodOpen.reason', { vatPeriod: periodLabel, endsOn: fmt.date(String(finalizeBlock.params.endsOn ?? '')) }) : null;
  const sentence = filedOn ? (amendmentDue ? t('header.amendment', { date: fmt.date(filedOn) }) : t('header.filed', { date: fmt.date(filedOn) })) : dueOn ? t(dueOn < today ? 'header.overdue' : 'header.purpose', { date: fmt.date(dueOn) }) : t('header.notRequired');
  const version = stage === 'final' ? finalVersion : null;
  const title = t('title', { period: periodLabel });
  return (
    <>
      <div data-testid="vat-header">
        <PageHeader
          title={title}
          status={
            amendmentDue ? (
              <StatusBadge tone="warning" dot>
                {t('amendmentOpen')}
              </StatusBadge>
            ) : (
              <StatusBadge tone={statusTone('reportStage', stage)} dot>
                {tReports(`stage.${stage}`)}
              </StatusBadge>
            )
          }
          description={
            <>
              <span className="block">{sentence}</span>
              <KeyLine className="mt-1">
                {version ? tReports('view.version', { date: fmt.date(version.finalizedAt), time: fmt.time(version.finalizedAt), hash: version.shortHash, number: version.documentNumber }) : tReports('view.generated', { date: fmt.dateTime(generatedAt), hash: shortHash })}
              </KeyLine>
            </>
          }
          more={[{ key: 'download', label: tReports('view.download'), icon: <Download className="size-4" aria-hidden />, disabled: busy, onSelect: () => void download(`${pdfHref}&download=1`, `umsatzsteuer-voranmeldung-${periodKey}.pdf`), testId: 'vat-download' }]}
          actions={
            finalizeShown && finalizable ? (
              <Button type="button" onClick={() => setFinalizing(true)} data-testid="vat-finalize">
                {tReports('view.finalize')}
              </Button>
            ) : finalizeShown && blockedSentence ? (
              <span className="text-meta text-muted-ink" data-testid="vat-finalize-blocked">
                {blockedSentence}
              </span>
            ) : undefined
          }
        />
      </div>
      <RefusalNotice action state={refusal} />
      {finalizeShown && finalizable ? <FinalizeDialog open={finalizing} onOpenChange={setFinalizing} reportKey="vatAdvanceReturn" params={{ vatPeriod: periodKey }} shortHash={shortHash} title={title} /> : null}
    </>
  );
}

/** Der Zeitraum als Rahmen (Muster `TaxPeriodBar`, MUSTER § L): neueste zuerst; schreibt `?period=`. */
export function VatPeriodBar({ options, period, count = 0 }: { options: readonly { key: string; label: string }[]; period: string; count?: number }) {
  // Eigener Name statt `t`: Der Wächter `message-keys` liest Übersetzer-Namensräume je Datei, nicht je Funktion.
  const tBar = useTranslations('finance.vat.bar');
  const router = useRouter();
  const [, startNavigation] = useTransition();
  const go = (value: string) => startNavigation(() => router.replace(`/finance/vat?period=${encodeURIComponent(value)}`));
  return (
    <FilterBar
      filters={[frameFilter({ key: 'period', label: tBar('label'), value: period, options: options.map((o) => ({ value: o.key, label: o.label })), onChange: go, testId: 'vat-period-select' })]}
      onApply={(values) => (values.period ? go(values.period) : undefined)}
      count={{ shown: count, total: count, noun: { one: tBar('noun.one'), other: tBar('noun.other'), dative: tBar('noun.dative') } }}
      onReset={() => undefined}
      testId="vat-period-bar"
    />
  );
}
