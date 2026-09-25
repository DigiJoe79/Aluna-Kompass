'use client';

import type { RunSummary } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge } from '@/components/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { runProgress } from '@/lib/finance/run';

/** Frühere Serienläufe unter der Seite (`listConfirmationRuns`), jüngste zuerst; „Öffnen“ zeigt Lauf oder Ergebnis. */
export function RunsList({ runs, currentId }: { runs: RunSummary[]; currentId: string | null }) {
  const t = useTranslations('finance.donations.run.runs');
  const tv = useTranslations('finance.donations.sentVia');
  const { date } = useDateFormat();

  const stateOf = (run: RunSummary) => {
    if (!run.finishedAt) return <StatusBadge tone="info">{t('state.running')}</StatusBadge>;
    if (run.counts.failed > 0) return <StatusBadge tone="warning">{t('state.withFailures', { count: run.counts.failed })}</StatusBadge>;
    return <StatusBadge tone="success">{t('state.finished')}</StatusBadge>;
  };

  return (
    <section className="space-y-2">
      <h3 className="text-[15px] font-semibold text-ink">{t('title')}</h3>
      {runs.length === 0 ? (
        <p className="text-[13px] text-muted-ink">{t('empty')}</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="h-9">
                <TableHead className="px-4">{t('columns.year')}</TableHead>
                <TableHead className="px-4">{t('columns.startedOn')}</TableHead>
                <TableHead className="px-4">{t('columns.issued')}</TableHead>
                <TableHead className="px-4">{t('columns.state')}</TableHead>
                <TableHead className="px-4">{t('columns.dispatched')}</TableHead>
                <TableHead className="px-4"><span className="sr-only">{t('columns.open')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id} data-testid="run-row" aria-current={run.id === currentId ? 'true' : undefined} className="h-row border-b border-line-2">
                  <TableCell className="px-4">
                    <span className="inline-flex items-center gap-2">
                      <span className="font-mono">{run.year}</span>
                      {run.followUpOfRunId ? <StatusBadge tone="neutral">{t('followUp')}</StatusBadge> : null}
                    </span>
                  </TableCell>
                  <TableCell className="px-4">{date(run.startedOn)}</TableCell>
                  <TableCell className="px-4 font-mono tabular-nums">{t('issued', { issued: run.counts.issued, total: runProgress(run.counts).total })}</TableCell>
                  <TableCell className="px-4">{stateOf(run)}</TableCell>
                  <TableCell className="px-4">{run.dispatchedAt && run.dispatchedVia ? `${date(run.dispatchedAt)} · ${tv(run.dispatchedVia)}` : '—'}</TableCell>
                  <TableCell className="px-4 text-right">
                    <Link href={`/finance/donations/run?run=${run.id}`} className="text-link underline">{t('open')}</Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
