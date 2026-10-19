'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { Section } from '@/components/section';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface EarlierRun {
  id: string;
  label: string;
  href: string;
  createdAt: string;
  result: string;
  running: boolean;
}

/** „Frühere Läufe“ unter der Seite, jüngste zuerst; die erste Spalte öffnet den Lauf (wie im Serienlauf). */
export function EarlierRuns({ runs, currentId, labelColumn, footer }: { runs: EarlierRun[]; currentId: string | null; labelColumn: string; footer?: ReactNode }) {
  const t = useTranslations('members.runs.earlier');
  const { date } = useDateFormat();
  return (
    <Section title={t('title')}>
      {runs.length === 0 ? (
        <p className="text-meta text-muted-ink">{t('empty')}</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead col="title">{labelColumn}</TableHead>
                <TableHead col="meta">{t('createdOn')}</TableHead>
                <TableHead col="meta">{t('result')}</TableHead>
                <TableHead col="status">{t('state')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id} data-testid="member-run-row" aria-current={run.id === currentId ? 'true' : undefined}>
                  <TableCell col="title"><RowLink href={run.href} className="tabular-nums">{run.label}</RowLink></TableCell>
                  <TableCell col="meta">{date(run.createdAt)}</TableCell>
                  <TableCell col="meta" wrap>{run.result}</TableCell>
                  {/* Abgeschlossen ist der Normalzustand: ohne Marke (MUSTER § F). */}
                  <TableCell col="status">{run.running ? <StatusBadge tone={statusTone('confirmationRun', 'running')} dot>{t('running')}</StatusBadge> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {footer}
        </div>
      )}
    </Section>
  );
}
