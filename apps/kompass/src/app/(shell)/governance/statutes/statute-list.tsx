'use client';

import type { StatuteState } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { Empty } from '@/components/empty-value';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface StatuteListRow { id: string; state: StatuteState; title: string; note: string | null; resolvedOn: string | null; registeredOn: string | null; tax: string }

/** Die Stände (Board 5a): Fassung, Beschlossen, Eingetragen, Finanzamt, Zustand; „abgelöst“ als gedämpfte Zeile. */
export function StatuteList({ rows }: { rows: StatuteListRow[] }) {
  const t = useTranslations('governance');
  const { date } = useDateFormat();
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead col="title">{t('statutes.columns.version')}</TableHead>
            <TableHead col="meta">{t('statutes.columns.resolved')}</TableHead>
            <TableHead col="meta">{t('statutes.columns.registered')}</TableHead>
            <TableHead col="meta" wrap>{t('statutes.columns.tax')}</TableHead>
            <TableHead col="status">{t('statutes.columns.state')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} muted={r.state === 'superseded' ? t('states.statute.superseded') : undefined}>
              <TableCell col="title">
                <RowLink href={`/governance/statutes/${r.id}`}>{r.title}</RowLink>
                {r.note ? <span className="block text-meta text-muted-ink">{r.note}</span> : null}
              </TableCell>
              <TableCell col="meta">{r.resolvedOn ? date(r.resolvedOn) : <Empty />}</TableCell>
              <TableCell col="meta">{r.registeredOn ? date(r.registeredOn) : <Empty />}</TableCell>
              <TableCell col="meta" wrap>{r.tax}</TableCell>
              <TableCell col="status">{r.state === 'superseded' ? null : <StatusBadge tone={statusTone('statute', r.state)} dot>{t(`states.statute.${r.state}`)}</StatusBadge>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
