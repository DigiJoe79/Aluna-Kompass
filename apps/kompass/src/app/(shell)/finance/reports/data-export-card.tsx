'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { RunSteps, type RunStep } from '@/components/run-steps';
import { SectionHeading } from '@/components/section';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { DataExportRunView } from '@/lib/finance/data-export-view';
import { formatSize } from '@/lib/format-size';
import { pollTextStatus } from '@/lib/poll-text-status';
import { useFileDownload } from '@/lib/use-file-download';
import { cancelDataExportAction } from './actions';
import { DataExportDialog, type DataExportYear } from './data-export-dialog';

const STEPS = ['entries', 'masterData', 'vouchers', 'history', 'package'] as const;

export interface DataExportRow {
  id: string;
  createdAt: string;
  designations: string;
  provisional: string;
  /** Name der erzeugenden Person; `null` ohne Nutzer (System). */
  byName: string | null;
  sizeBytes: number;
}

/** Die fünf Schritte des Laufs für `RunSteps`; ein gescheiterter Schritt nennt den Grund. */
export function dataExportSteps(view: DataExportRunView, t: (key: string) => string): RunStep[] {
  return STEPS.map((key) => {
    const step = view.steps.find((s) => s.key === key);
    // Gescheitert, abgebrochen oder unterbrochen: Der Schritt, der lief, trägt den Grund.
    const failed = (view.state === 'failed' || view.state === 'aborted' || view.state === 'interrupted') && step?.state === 'running';
    return {
      key,
      label: t(`steps.${key}`),
      state: failed ? 'failed' : (step?.state ?? 'pending'),
      progress: step?.state === 'running' && step.total ? { done: step.done ?? 0, total: step.total } : null,
      note: failed ? view.error?.message : undefined,
    };
  });
}

/**
 * Datenexport für eine Außenprüfung (Board 13f, Designer Runde 4 § 2.4): eine Karte unter der Berichtsliste, gebaut wie
 * die Prüfpaket-Karte. Kopf mit „Export erzeugen …“, während des Laufs `RunSteps` und „Abbrechen“, darunter die Exporte
 * der letzten 30 Tage. Der Stand kommt über die Status-Route (Polling), nach dem Ende lädt die Seite die Liste neu.
 */
export function DataExportCard({ initial, rows, years }: { initial: DataExportRunView; rows: readonly DataExportRow[]; years: readonly DataExportYear[] }) {
  const t = useTranslations('finance.reports.dataExport');
  const fmt = useDateFormat();
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const feedback = useActionFeedback();
  const file = useFileDownload({ forbidden: t('downloadRefused.forbidden'), notFound: t('downloadRefused.notFound'), failed: t('downloadRefused.failed') });
  // Abgefragt wird, solange ein Lauf läuft oder gerade angestoßen wurde (App-B4): über `pollTextStatus`, das nach einem
  // fehlgeschlagenen Abruf mit Abstand weiterfragt und nach dem Verlassen der Seite nichts mehr plant.
  // Jeder Anstoß (Start, Abbrechen) beginnt eine neue Kette, auch wenn die vorige aufgegeben hat.
  const [watch, setWatch] = useState(initial.state === 'running' ? 1 : 0);
  const poll = () => setWatch((n) => n + 1);

  useEffect(() => {
    if (watch === 0) return;
    return pollTextStatus({
      url: '/finance/data-export/status',
      isPending: (body) => body.state === 'running',
      onTick: (body) => setView(body as unknown as DataExportRunView),
      onDone: () => router.refresh(),
      onUnauthorized: () => router.refresh(),
    });
  }, [watch, router]);

  const cancel = async () => {
    const result = await feedback.run(() => cancelDataExportAction(), { retry: () => void cancel() });
    if (result.status === 'success') poll();
  };

  const running = view.state === 'running';
  const stopped = view.state === 'failed' || view.state === 'aborted' || view.state === 'interrupted';
  const yearsLabel = (row: DataExportRow) => {
    const provisional = new Set(row.provisional ? row.provisional.split(', ') : []);
    return row.designations.split(', ').map((y) => (provisional.has(y) ? t('list.provisional', { year: y }) : y)).join(' · ');
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4" data-testid="data-export">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <SectionHeading>{t('title')}</SectionHeading>
          <p className="text-meta text-muted-ink">{t('intro')}</p>
        </div>
        {running ? (
          <Button type="button" variant="outline" size="sm" disabled={!view.cancellable} onClick={() => void cancel()}>
            {t('cancel')}
          </Button>
        ) : (
          <Button ref={opener} type="button" variant="outline" size="sm" onClick={() => setDialogOpen(true)} data-testid="data-export-start">
            {t('start')}
          </Button>
        )}
      </div>
      <RefusalNotice action state={feedback.state} />
      {running ? (
        <div className="flex flex-col gap-2" data-testid="data-export-run">
          <p className="text-body text-ink">{t('running', { years: view.designations ?? '' })}</p>
          <RunSteps steps={dataExportSteps(view, t)} label={t('title')} />
          <p className="text-meta text-muted-ink">{t('leave')}</p>
        </div>
      ) : stopped ? (
        <div className="flex flex-col gap-2" data-testid="data-export-run">
          <p className="text-meta text-muted-ink">{t(`state.${view.state}`, { date: fmt.dateTime(view.finishedAt) })}</p>
          <RunSteps steps={dataExportSteps(view, t)} label={t('title')} />
        </div>
      ) : null}
      <Table aria-label={t('list.label')}>
        <TableHeader>
          <TableRow>
            <TableHead col="title">{t('list.created')}</TableHead>
            <TableHead col="meta">{t('list.years')}</TableHead>
            <TableHead col="meta">{t('list.by')}</TableHead>
            <TableHead col="meta">{t('list.size')}</TableHead>
            <TableHead col="actions" className="w-11">
              <span className="sr-only">{t('list.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={5}>{t('list.empty')}</TableEmpty>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} data-export-row={row.id}>
                <TableCell col="title">{fmt.dateTime(row.createdAt)}</TableCell>
                <TableCell col="meta" className="text-ink-2">{yearsLabel(row)}</TableCell>
                <TableCell col="meta" className="text-ink-2">{row.byName ?? t('list.system')}</TableCell>
                <TableCell col="meta" className="tabular-nums text-ink-2">{formatSize(row.sizeBytes)}</TableCell>
                <TableCell col="actions" className="text-right">
                  {/* Die Arbeit dieser Liste (MUSTER § G, Ausnahme wie „Endsaldo nachtragen“): sichtbar, nicht im ⋯ — rechts in
                      der letzten Spalte als Symbolknopf wie die Zeilenhandlungen (Designer Runde 6, 270). */}
                  <Button type="button" variant="ghost" size="icon" aria-label={t('list.downloadRow', { date: fmt.dateTime(row.createdAt) })} title={t('list.download')} disabled={file.busy} onClick={() => void file.download(`/finance/data-export/${encodeURIComponent(row.id)}/file`, 'Datenexport.zip')}>
                    <Download className="size-4" aria-hidden />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <RefusalNotice state={file.refusal} />
      <p className="text-meta text-muted-ink">{t('list.keep')}</p>
      <DataExportDialog open={dialogOpen} onOpenChange={setDialogOpen} years={years} finalFocus={opener} onStarted={poll} />
    </div>
  );
}
