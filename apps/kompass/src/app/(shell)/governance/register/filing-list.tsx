'use client';

import type { FilingState } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { Empty } from '@/components/empty-value';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface FilingListRow { id: string; title: string; meeting: string | null; createdOn: string; registeredOn: string | null; notary: string | null; state: FilingState }

/** Die Anmeldungen (Board 8a): eingetragen ist der Normalzustand ohne Marke. */
export function FilingList({ rows }: { rows: FilingListRow[] }) {
  const t = useTranslations('governance');
  const { date } = useDateFormat();
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead col="title">{t('register.columns.occasion')}</TableHead>
            <TableHead col="meta">{t('register.columns.created')}</TableHead>
            <TableHead col="meta">{t('register.columns.notary')}</TableHead>
            <TableHead col="status">{t('register.columns.state')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell col="title">
                <RowLink href={`/governance/register/${r.id}`}>{r.title}</RowLink>
                {r.meeting ? <span className="block text-meta text-muted-ink">{r.meeting}</span> : null}
              </TableCell>
              <TableCell col="meta">{r.registeredOn ? t('register.registeredShort', { date: date(r.registeredOn) }) : t('register.createdShort', { date: date(r.createdOn) })}</TableCell>
              <TableCell col="meta">{r.notary ?? <Empty />}</TableCell>
              <TableCell col="status">{r.state === 'registered' ? null : <StatusBadge tone={statusTone('registration', r.state)} dot>{t(`states.registration.${r.state}`)}</StatusBadge>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
