'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { FilterBar, selectFilter } from '@/components/filter-bar';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { CircularState } from '@/lib/governance/circular-state';
import { useUrlFilters } from '@/lib/use-url-filters';

export interface CircularListRow { id: string; subject: string; organ: string; requestedOn: string; deadline: string; state: CircularState; sealed: boolean }
type Filters = { organ: string; year: string };

/** Liste der Umläufe: festgeschrieben und zustande gekommen ist der Normalzustand ohne Marke. */
export function CircularList({ rows, total, organs, years }: { rows: CircularListRow[]; total: number; organs: { id: string; name: string }[]; years: string[] }) {
  const t = useTranslations('governance.circulars');
  const ts = useTranslations('governance.states.circular');
  const { date } = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useUrlFilters<Filters>({ organ: params.get('organ') ?? '', year: params.get('year') ?? '' });
  const apply = (patch: Partial<Filters>) => {
    const merged = { ...filters, ...patch };
    setFilters(merged);
    const next = new URLSearchParams(Object.entries(merged).filter(([, v]) => v !== ''));
    startTransition(() => router.replace(next.size ? `${pathname}?${next.toString()}` : pathname));
  };
  const reset = () => apply({ organ: '', year: '' });
  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        filters={[
          selectFilter({ key: 'organ', label: t('filterOrgan'), value: filters.organ, options: organs.map((o) => ({ value: o.id, label: o.name })), onChange: (organ) => apply({ organ }) }),
          selectFilter({ key: 'year', label: t('filterYear'), value: filters.year, options: years.map((y) => ({ value: y, label: y })), onChange: (year) => apply({ year }) }),
        ]}
        onApply={(values) => apply(values as Partial<Filters>)}
        count={{ shown: rows.length, total, noun: { one: t('noun.one'), other: t('noun.other'), dative: t('noun.dative') } }}
        onReset={reset}
        testId="circulars-filters"
      />
      {rows.length === 0 ? (
        <EmptyState filtered={{ noun: t('filteredNoun'), onReset: reset }} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead col="title">{t('columns.subject')}</TableHead>
                <TableHead col="meta">{t('columns.organ')}</TableHead>
                <TableHead col="meta">{t('columns.requested')}</TableHead>
                <TableHead col="meta">{t('columns.deadline')}</TableHead>
                <TableHead col="status">{t('columns.state')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell col="title" truncate title={r.subject}>
                    <RowLink href={`/governance/circulars/${r.id}`}>{r.subject}</RowLink>
                  </TableCell>
                  <TableCell col="meta">{r.organ}</TableCell>
                  <TableCell col="meta">{date(r.requestedOn)}</TableCell>
                  <TableCell col="meta">{date(r.deadline)}</TableCell>
                  <TableCell col="status">{r.sealed && r.state === 'passed' ? null : <StatusBadge tone={statusTone('circular', r.state)} dot>{ts(r.state, { date: date(r.deadline) })}</StatusBadge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
