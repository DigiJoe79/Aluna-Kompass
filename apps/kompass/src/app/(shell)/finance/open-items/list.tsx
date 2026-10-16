'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { FilterBar, selectFilter } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { ListPager } from '@/components/list-pager';
import { ViewTabs } from '@/components/view-tabs';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { formatDateOrDash } from '@/lib/finance/dates';
import { OPEN_ITEM_FILTER_STATES, type OpenItemsStateFilter } from '@/lib/finance/open-item-state';
import { useUrlFilters } from '@/lib/use-url-filters';
import { usePathname, useRouter } from 'next/navigation';
import { ItemDialog } from './item-dialog';
import { Empty } from '@/components/empty-value';

export interface OpenItemRow {
  id: string;
  kind: 'receivable' | 'payable';
  dueOn: string | null;
  contactLabel: string | null;
  amountCents: number;
  openCents: number;
  hasOrigin: boolean;
  paymentReference: string | null;
  word: 'open' | 'partlyPaid' | 'settled' | 'settledWithoutPayment';
  overdue: boolean;
  /** Befund 6: > 0, solange eine Zahlung dafür als Entwurf vorliegt — dann steht das statt „überfällig“. */
  draftSettlementCents: number;
}

/**
 * Tabelle der offenen Zahlungen (Task 3, A6): Reiter aus der URL, ein Klick
 * öffnet das Detail als Sheet (`?item=`), „überfällig“ steht als Wort im
 * Zustand und färbt das Datum.
 */
export function OpenItemsList({ rows, tab, state, page, total, tabTotal, pageSize, canWrite, canCreateContact, today }: {
  rows: OpenItemRow[];
  tab: 'receivable' | 'payable';
  /** Zustandsfilter, Vorgabe „offen“ (07-2 A1). */
  state: OpenItemsStateFilter;
  page: number;
  /** Treffer unter dem Filter. */
  total: number;
  /** Alle Posten des Reiters — die Zählzeile „{shown} von {total}“. */
  tabTotal: number;
  pageSize: number;
  canWrite: boolean;
  canCreateContact: boolean;
  today: string;
}) {
  const t = useTranslations('finance.openItems');
  const { date } = useDateFormat();
  const [newOpen, setNewOpen] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const [, startNavigation] = useTransition();
  // Im Filter ist „alle“ der leere Wert (`selectFilter`), in der Adresse `state=all`; „offen“ ist die Vorgabe ohne Angabe.
  const [filters, setFilters] = useUrlFilters({ state: state === 'all' ? '' : state });
  const stateQuery = (value: string) => (value === '' ? '&state=all' : value === 'open' ? '' : `&state=${value}`);
  const applyState = (value: string) => {
    setFilters({ state: value });
    startNavigation(() => router.replace(`${pathname}?tab=${tab}${stateQuery(value)}`));
  };

  const tabHref = (next: 'receivable' | 'payable') => `/finance/open-items?tab=${next}${stateQuery(filters.state)}`;
  const pageHref = (n: number) => `/finance/open-items?tab=${tab}${stateQuery(filters.state)}${n > 1 ? `&page=${n}` : ''}`;
  const resetFilters = () => applyState('');

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
        actions={
          canWrite ? (
            <Button type="button" onClick={() => setNewOpen(true)}>
              {t('new')}
            </Button>
          ) : undefined
        }
      />

      <ViewTabs label={t('tabsGroup')} current={tab} tabs={(['payable', 'receivable'] as const).map((k) => ({ key: k, label: t(`tabs.${k}`), href: tabHref(k) }))} />

      <FilterBar
        filters={[
          selectFilter({
            key: 'state',
            label: t('filter.state'),
            value: filters.state,
            options: OPEN_ITEM_FILTER_STATES.map((value) => ({ value, label: t(`filter.states.${value}`) })),
            onChange: applyState,
            testId: 'open-items-state',
          }),
        ]}
        onApply={(values) => applyState(values.state ?? filters.state)}
        count={{ shown: total, total: tabTotal, noun: { one: t('filter.nounOne'), other: t('filter.nounOther'), dative: t('filter.nounDative') } }}
        onReset={resetFilters}
      />

      {rows.length === 0 ? (
        tabTotal > 0 ? (
          <EmptyState filtered={{ noun: t('filter.emptyNoun'), onReset: resetFilters }} />
        ) : (
          <EmptyState title={t('empty.title')} text={t('empty.text')} />
        )
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.dueOn')}</TableHead>
                <TableHead>{t('columns.contact')}</TableHead>
                <TableHead>{t('columns.amount')}</TableHead>
                <TableHead>{t('columns.open')}</TableHead>
                <TableHead>{t('columns.origin')}</TableHead>
                <TableHead>{t('columns.reference')}</TableHead>
                <TableHead>{t('columns.state')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <RowLink href={`${pageHref(page)}&item=${row.id}`} className={row.overdue ? 'text-error' : 'text-ink'}>
                      {formatDateOrDash(date, row.dueOn)}
                    </RowLink>
                  </TableCell>
                  <TableCell>{row.contactLabel ?? <Empty />}</TableCell>
                  <TableCell className="tabular-nums">{formatEuro(row.amountCents)}</TableCell>
                  <TableCell className="tabular-nums">{formatEuro(row.openCents)}</TableCell>
                  <TableCell>{row.hasOrigin ? t('hasOrigin') : <Empty />}</TableCell>
                  <TableCell selectable>{row.paymentReference ?? <Empty />}</TableCell>
                  <TableCell>
                    {t(`state.${row.word}`)}
                    {row.overdue ? ` · ${row.draftSettlementCents > 0 ? t('draftSettlement') : t('overdue')}` : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ListPager total={total} offset={(page - 1) * pageSize} pageSize={pageSize} hrefFor={(next) => pageHref(Math.floor(next / pageSize) + 1)} footer testId="open-items-pager" />
        </div>
      )}

      {newOpen ? (
        <ItemDialog open={newOpen} onOpenChange={setNewOpen} item={null} defaultKind={tab} canCreateContact={canCreateContact} today={today} />
      ) : null}
    </div>
  );
}
