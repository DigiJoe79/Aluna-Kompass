'use client';

import type { MemberListView, MemberOverviewRow } from '@kompass/module-members';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { Empty } from '@/components/empty-value';
import { checkFilter, FilterBar, selectFilter } from '@/components/filter-bar';
import { ListPager } from '@/components/list-pager';
import { SearchField } from '@/components/search-field';
import { SortableHead } from '@/components/sortable-head';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ViewTabs } from '@/components/view-tabs';
import { formatEuro } from '@/lib/finance/amount';
import { useUrlFilters } from '@/lib/use-url-filters';
import { PAGE_SIZE, VIEW_FILTERS } from './list-params';

type Filters = { text: string; type: string; pay: string; arrears: string; rejected: string };

export interface MemberListProps {
  view: MemberListView;
  rows: MemberOverviewRow[];
  counts: Record<MemberListView, number>;
  /** Treffer im Reiter mit Filtern und ohne. */
  total: number;
  unfiltered: number;
  offset: number;
  types: { id: string; name: string }[];
}

/**
 * Die Mitgliederliste (Handoff Mitglieder 2.1, D2, D8): Reiter Mitglieder · Anträge · Ausgetreten, Name in Spalte 1
 * öffnet, Nr. sortierbar. Aktiv ohne Rückstand trägt keine Marke; höchstens eine Mahnstufe, sie ersetzt „überfällig“.
 * In „Anträge“ und „Ausgetreten“ haben alle Zeilen denselben Zustand — dort weder Marke noch gedämpfte Zeile.
 */
export function MemberList({ view, rows, counts, total, unfiltered, offset, types }: MemberListProps) {
  const t = useTranslations('members.list');
  const tp = useTranslations('members.payment');
  const { date } = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const allowed = VIEW_FILTERS[view];

  const [filters, setFilters] = useUrlFilters<Filters>({
    text: params.get('text') ?? '',
    type: params.get('type') ?? '',
    pay: params.get('pay') ?? '',
    arrears: params.get('arrears') === '1' ? '1' : '',
    rejected: params.get('rejected') === '1' ? '1' : '',
  });

  /** Adresse eines Reiters: die Filter, die er kennt, und die Sortierung; nie die Seite. */
  const hrefFor = (target: MemberListView, values: Filters) => {
    const next = new URLSearchParams();
    if (target !== 'members') next.set('view', target);
    for (const key of VIEW_FILTERS[target]) {
      const value = key === 'text' ? values.text.trim() : values[key];
      if (value) next.set(key, value);
    }
    for (const key of ['sort', 'dir']) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const applyFilters = (patch: Partial<Filters>) => {
    const merged = { ...filters, ...patch };
    setFilters(merged);
    startTransition(() => router.replace(hrefFor(view, merged)));
  };
  const reset = () => applyFilters({ text: '', type: '', pay: '', arrears: '', rejected: '' });
  const noun = view === 'applications' ? { one: t('nounApplications.one'), other: t('nounApplications.other'), dative: t('nounApplications.dative') } : { one: t('noun.one'), other: t('noun.other'), dative: t('noun.dative') };
  const filtered = allowed.some((key) => (key === 'text' ? filters.text.trim() : filters[key]) !== '');

  const typeFilter = selectFilter({ key: 'type', label: t('filterType'), value: filters.type, options: types.map((ty) => ({ value: ty.id, label: ty.name })), onChange: (type) => applyFilters({ type }) });
  const payFilter = selectFilter({
    key: 'pay',
    label: t('filterPayment'),
    value: filters.pay,
    options: [
      { value: 'transfer', label: tp('transfer') },
      { value: 'directDebit', label: tp('directDebit') },
    ],
    onChange: (pay) => applyFilters({ pay }),
  });
  const arrearsFilter = checkFilter({ key: 'arrears', label: t('onlyArrears'), value: filters.arrears === '1', onChange: (on) => applyFilters({ arrears: on ? '1' : '' }) });
  const rejectedFilter = checkFilter({ key: 'rejected', label: t('alsoRejected'), value: filters.rejected === '1', onChange: (on) => applyFilters({ rejected: on ? '1' : '' }) });
  const slots = view === 'members' ? [typeFilter, payFilter, arrearsFilter] : view === 'left' ? [typeFilter] : [rejectedFilter];

  const typeName = (id: string) => types.find((ty) => ty.id === id)?.name ?? '';
  const yearly = (r: MemberOverviewRow) => (r.exempt ? <span className="text-muted-ink">{t('exempt')}</span> : r.yearlyCents !== null ? formatEuro(r.yearlyCents) : <Empty />);
  const payment = (r: MemberOverviewRow) => (r.paymentMethod ? tp(r.paymentMethod) : <Empty />);
  const day = (value: string | null) => (value ? date(value) : <Empty />);

  const papers = (r: MemberOverviewRow) => [r.applicationDocumentId ? t('papers.application') : null, r.mandateState === 'pending' ? t('papers.mandatePrepared') : null].filter(Boolean).join(' · ');

  const emptyTexts: Record<MemberListView, { title: string; text: string }> = {
    members: { title: t('empty.title'), text: t('empty.text') },
    applications: { title: t('empty.applications'), text: t('empty.applicationsText') },
    left: { title: t('empty.left'), text: t('empty.leftText') },
  };

  return (
    <div className="flex flex-col gap-3">
      <ViewTabs
        label={t('views')}
        current={view}
        tabs={(['members', 'applications', 'left'] as const).map((key) => ({ key, label: t(`tabs.${key}`), href: hrefFor(key, filters), count: counts[key], testId: `members-tab-${key}` }))}
      />

      <FilterBar
        search={<SearchField value={filters.text} onChange={(text) => applyFilters({ text })} placeholder={view === 'applications' ? t('searchApplications') : t('search')} placeholderShort={t('searchShort')} />}
        searchActive={filters.text.trim() ? { chip: filters.text.trim(), onClear: () => applyFilters({ text: '' }) } : undefined}
        filters={slots}
        onApply={(values) => applyFilters(values as Partial<Filters>)}
        count={{ shown: total, total: unfiltered, noun }}
        onReset={reset}
        testId="members-filters"
      />

      {rows.length === 0 && filtered ? (
        <EmptyState filtered={{ noun: t('empty.filteredNoun'), onReset: reset }} />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTexts[view].title} text={emptyTexts[view].text} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          {view === 'members' ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead col="title" field="name" label={t('columns.name')} byDefault="asc" />
                  <SortableHead col="meta" field="number" label={t('columns.number')} />
                  <TableHead col="meta">{t('columns.type')}</TableHead>
                  <TableHead col="meta">{t('columns.joinedOn')}</TableHead>
                  <TableHead>{t('columns.payment')}</TableHead>
                  <TableHead col="amount" className="text-right">{t('columns.yearly')}</TableHead>
                  <TableHead col="status">{t('columns.state')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-testid="member-row">
                    <TableCell col="title"><RowLink href={`/members/${r.id}`}>{r.contactName}</RowLink></TableCell>
                    <TableCell col="meta" className="tabular-nums text-ink-2">{r.memberNumber}</TableCell>
                    <TableCell col="meta" className="text-ink-2">{typeName(r.typeId)}</TableCell>
                    <TableCell col="meta" className="text-ink-2">{day(r.joinedOn)}</TableCell>
                    <TableCell className="text-ink-2">{payment(r)}</TableCell>
                    <TableCell col="amount" className="text-right tabular-nums text-ink">{yearly(r)}</TableCell>
                    {/* Zustand: eine Marke (Kartenzeile am Telefon hat einen Platz). Ein Rückstand geht vor „endet am …“, denn er
                        ist Arbeit; das Ende steht auf der Mitglied-Seite. Aktiv ohne Rückstand bleibt leer (D2). */}
                    <TableCell col="status">
                      {r.arrears?.levelName ? (
                        <StatusBadge tone={statusTone('dunning', r.arrears.lastLevel ? 'lastLevel' : 'level')} dot>{r.arrears.levelName}</StatusBadge>
                      ) : r.arrears ? (
                        <StatusBadge tone={statusTone('fee', 'overdue')} dot>{t('overdue')}</StatusBadge>
                      ) : r.status === 'ending' && r.endsOn ? (
                        <StatusBadge tone={statusTone('membership', 'ending')} dot>{t('endsOn', { date: date(r.endsOn) })}</StatusBadge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : view === 'applications' ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead col="title" field="name" label={t('columns.name')} byDefault="asc" />
                  <TableHead col="meta">{t('columns.type')}</TableHead>
                  <TableHead col="meta">{t('columns.appliedOn')}</TableHead>
                  <TableHead>{t('columns.payment')}</TableHead>
                  <TableHead col="amount" className="text-right">{t('columns.yearly')}</TableHead>
                  <TableHead>{t('columns.papers')}</TableHead>
                  {/* Nur mit „Auch abgelehnte“ gemischt: dann trägt die abgelehnte Zeile ihre Marke (D2), offene keine. */}
                  <TableHead col="status">{t('columns.state')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-testid="member-row">
                    <TableCell col="title"><RowLink href={`/members/${r.id}`}>{r.contactName}</RowLink></TableCell>
                    <TableCell col="meta" className="text-ink-2">{typeName(r.typeId)}</TableCell>
                    <TableCell col="meta" className="text-ink-2">{day(r.appliedOn)}</TableCell>
                    <TableCell className="text-ink-2">{payment(r)}</TableCell>
                    <TableCell col="amount" className="text-right tabular-nums text-ink">{yearly(r)}</TableCell>
                    <TableCell className="text-meta text-muted-ink">{papers(r) || <Empty />}</TableCell>
                    <TableCell col="status">{r.status === 'rejected' ? <StatusBadge tone={statusTone('membership', 'rejected')} dot>{t('rejected')}</StatusBadge> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead col="title" field="name" label={t('columns.name')} byDefault="asc" />
                  <SortableHead col="meta" field="number" label={t('columns.number')} />
                  <TableHead col="meta">{t('columns.type')}</TableHead>
                  <TableHead col="meta">{t('columns.endsOn')}</TableHead>
                  <TableHead>{t('columns.joinedOn')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-testid="member-row">
                    <TableCell col="title"><RowLink href={`/members/${r.id}`}>{r.contactName}</RowLink></TableCell>
                    <TableCell col="meta" className="tabular-nums text-ink-2">{r.memberNumber}</TableCell>
                    <TableCell col="meta" className="text-ink-2">{typeName(r.typeId)}</TableCell>
                    <TableCell col="meta" className="text-ink-2">{day(r.endsOn)}</TableCell>
                    <TableCell className="text-ink-2">{day(r.joinedOn)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <ListPager
            total={total}
            offset={offset}
            pageSize={PAGE_SIZE}
            hrefFor={(next) => {
              const qs = new URLSearchParams(params.toString());
              const target = Math.floor(next / PAGE_SIZE) + 1;
              if (target > 1) qs.set('page', String(target));
              else qs.delete('page');
              return qs.toString() ? `${pathname}?${qs.toString()}` : pathname;
            }}
            footer
            testId="members-pager"
          />
        </div>
      )}
    </div>
  );
}
