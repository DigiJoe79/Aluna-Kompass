'use client';

import type { RunSummary } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { runProgress } from '@/lib/finance/run';
import { Section } from '@/components/section';
import { Empty } from '@/components/empty-value';

/** Frühere Serienläufe unter der Seite (`listConfirmationRuns`), jüngste zuerst; „Öffnen“ zeigt Lauf oder Ergebnis. */
export function RunsList({ runs, currentId, footer }: { runs: RunSummary[]; currentId: string | null; /** Fuß der Tabellenkarte: `ListPager footer`. */ footer?: ReactNode }) {
  const t = useTranslations('finance.donations.run.runs');
  const tv = useTranslations('finance.donations.sentVia');
  const { date } = useDateFormat();

  const stateOf = (run: RunSummary) => {
    if (!run.finishedAt) return <StatusBadge tone={statusTone('confirmationRun', 'running')}>{t('state.running')}</StatusBadge>;
    if (run.counts.failed > 0) return <StatusBadge tone={statusTone('confirmationRun', 'withFailures')}>{t('state.withFailures', { count: run.counts.failed })}</StatusBadge>;
    // Abgeschlossen ist der Normalzustand: in der Liste ohne Marke (Designer Stufe 2 Nr. 6a).
    return null;
  };

  return (
    <Section title={t('title')}>
      <div className="space-y-2">
        {runs.length === 0 ? (
          <p className="text-meta text-muted-ink">{t('empty')}</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead col="title">{t('columns.year')}</TableHead>
                  <TableHead col="meta">{t('columns.startedOn')}</TableHead>
                  <TableHead col="meta">{t('columns.issued')}</TableHead>
                  <TableHead col="status">{t('columns.state')}</TableHead>
                  <TableHead col="meta">{t('columns.dispatched')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id} data-testid="run-row" aria-current={run.id === currentId ? 'true' : undefined}>
                    <TableCell col="title">
                      <span className="inline-flex items-center gap-2">
                        {/* 09 B17: Das Jahr in der ersten Spalte öffnet den Lauf (`RowLink`, § G), kein „Öffnen“ in der letzten. */}
                        <RowLink href={`/finance/donations/run?run=${run.id}`} className="tabular-nums">{run.year}</RowLink>
                        {run.followUpOfRunId ? <StatusBadge tone="neutral">{t('followUp')}</StatusBadge> : null}
                      </span>
                    </TableCell>
                    <TableCell col="meta">{date(run.startedOn)}</TableCell>
                    <TableCell col="meta" className="tabular-nums">{t('issued', { issued: run.counts.issued, total: runProgress(run.counts).total })}</TableCell>
                    <TableCell col="status">{stateOf(run)}</TableCell>
                    <TableCell col="meta">{run.dispatchedAt && run.dispatchedVia ? `${date(run.dispatchedAt)} · ${tv(run.dispatchedVia)}` : <Empty />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {footer}
          </div>
        )}
      </div>
    </Section>
  );
}
