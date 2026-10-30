'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { FilterBar, selectFilter } from '@/components/filter-bar';
import { StatusBadge, statusTone, type STATUS_TONES } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUrlFilters } from '@/lib/use-url-filters';

export interface MeetingListRow {
  id: string;
  heldOn: string;
  title: string;
  sub: string;
  organ: string;
  badge: { status: keyof (typeof STATUS_TONES)['meeting']; label: string } | null;
}

type Filters = { organ: string; year: string; state: string };

/** Die Sitzungsliste (Plan U1 Task 4): Datum, Sitzung (öffnet), Organ, Zustand; festgeschrieben ohne Marke. */
export function MeetingList({ rows, total, organs, years, states }: { rows: MeetingListRow[]; total: number; organs: { id: string; name: string }[]; years: string[]; states: { value: string; label: string }[] }) {
  const t = useTranslations('governance.meetings');
  const { date } = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useUrlFilters<Filters>({ organ: params.get('organ') ?? '', year: params.get('year') ?? '', state: params.get('state') ?? '' });

  const apply = (patch: Partial<Filters>) => {
    const merged = { ...filters, ...patch };
    setFilters(merged);
    const next = new URLSearchParams(Object.entries(merged).filter(([, v]) => v !== ''));
    startTransition(() => router.replace(next.size ? `${pathname}?${next.toString()}` : pathname));
  };
  const reset = () => apply({ organ: '', year: '', state: '' });
  const filtered = Object.values(filters).some((v) => v !== '');

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        filters={[
          selectFilter({ key: 'organ', label: t('filterOrgan'), value: filters.organ, options: organs.map((o) => ({ value: o.id, label: o.name })), onChange: (organ) => apply({ organ }) }),
          selectFilter({ key: 'year', label: t('filterYear'), value: filters.year, options: years.map((y) => ({ value: y, label: y })), onChange: (year) => apply({ year }) }),
          selectFilter({ key: 'state', label: t('filterState'), value: filters.state, options: states, onChange: (state) => apply({ state }) }),
        ]}
        onApply={(values) => apply(values as Partial<Filters>)}
        count={{ shown: rows.length, total, noun: { one: t('noun.one'), other: t('noun.other'), dative: t('noun.dative') } }}
        onReset={reset}
        testId="meetings-filters"
      />
      {rows.length === 0 && filtered ? (
        <EmptyState filtered={{ noun: t('empty.filteredNoun'), onReset: reset }} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead col="meta">{t('columns.date')}</TableHead>
                <TableHead col="title">{t('columns.meeting')}</TableHead>
                <TableHead col="meta">{t('columns.organ')}</TableHead>
                <TableHead col="status">{t('columns.state')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell col="meta">{date(r.heldOn)}</TableCell>
                  <TableCell col="title">
                    <RowLink href={`/governance/meetings/${r.id}`}>{r.title}</RowLink>
                    {r.sub ? <span className="block text-meta text-muted-ink">{r.sub}</span> : null}
                  </TableCell>
                  <TableCell col="meta">{r.organ}</TableCell>
                  <TableCell col="status">{r.badge ? <StatusBadge tone={statusTone('meeting', r.badge.status)} dot>{r.badge.label}</StatusBadge> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
