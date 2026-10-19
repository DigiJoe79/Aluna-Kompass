'use client';

import { maskIban } from '@kompass/module-finance/format';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { Empty } from '@/components/empty-value';
import { FilterBar, frameFilter, selectFilter } from '@/components/filter-bar';
import { ListPager } from '@/components/list-pager';
import { SearchField } from '@/components/search-field';
import { StatusBadge, isNormalInList, statusTone } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ViewTabs } from '@/components/view-tabs';
import { formatEuro } from '@/lib/finance/amount';
import { useUrlFilters } from '@/lib/use-url-filters';
import { MANDATE_STATES, PAGE_SIZE, PLEDGE_STATES, RUN_STATES, VIEW_FILTERS, type DirectDebitView } from './list-params';

export interface RunRow {
  id: string;
  collectionDate: string;
  count: number;
  submittedOn: string | null;
  accountName: string;
  sumCents: number;
  status: (typeof RUN_STATES)[number];
  openReturns: number;
}

export interface MandateRow {
  id: string;
  payer: string;
  reference: string;
  /** Maskiert vom Dienst; `maskIban` hält sie maskiert. */
  iban: string;
  signedOn: string | null;
  usedFor: ('membership' | 'application' | 'pledge')[];
  state: (typeof MANDATE_STATES)[number];
}

export interface PledgeRow {
  id: string;
  name: string;
  interval: 'monthly' | 'quarterly' | 'halfYearly' | 'yearly';
  bound: string | null;
  nextDueOn: string | null;
  paymentMethod: 'directDebit' | 'transfer' | 'standingOrder';
  amountCents: number;
  state: (typeof PLEDGE_STATES)[number];
}

type Filters = { year: string; state: string; text: string; bound: string };

export interface DirectDebitListProps {
  view: DirectDebitView;
  counts: Record<DirectDebitView, number>;
  total: number;
  unfiltered: number;
  offset: number;
  year: number;
  /** Das Jahr ohne `?year=`: das laufende. */
  defaultYear: number;
  years: number[];
  runs: RunRow[];
  mandates: MandateRow[];
  pledges: PledgeRow[];
  bindings: { value: string; label: string }[];
}

/**
 * Lastschrift (Handoff 2a § 1.1, 11a–11d, D2, D8): Reiter Einzüge · Mandate · Zusagen, je Reiter Filterleiste und
 * Tabelle. Normalzustände ohne Marke (gebucht, aktiv); beendete und abgelaufene Mandate, ruhende und beendete Zusagen
 * sind gedämpfte Zeilen mit Marke hinter dem Namen. Ein gebuchter Einzug mit offener Rückgabe zeigt nur diese.
 */
export function DirectDebitList(props: DirectDebitListProps) {
  const { view, counts, total, unfiltered, offset, year, defaultYear, years } = props;
  const t = useTranslations('finance.directDebit.list');
  const ts = useTranslations('finance.directDebit.states');
  const { date } = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useUrlFilters<Filters>({ year: String(year), state: params.get('state') ?? '', text: params.get('text') ?? '', bound: params.get('bound') ?? '' });

  /** Adresse eines Reiters: nur die Filter, die er kennt; nie die Seite. */
  const hrefFor = (target: DirectDebitView, values: Filters) => {
    const next = new URLSearchParams();
    if (target !== 'runs') next.set('view', target);
    if (target === view) {
      for (const key of VIEW_FILTERS[target]) {
        const value = key === 'text' ? values.text.trim() : values[key];
        if (value && !(key === 'year' && value === String(defaultYear))) next.set(key, value);
      }
    }
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const apply = (patch: Partial<Filters>) => {
    const merged = { ...filters, ...patch };
    setFilters(merged);
    startTransition(() => router.replace(hrefFor(view, merged)));
  };
  const reset = () => apply({ state: '', text: '', bound: '' });
  const filtered = Boolean(filters.state || (view !== 'runs' && filters.text.trim()) || (view === 'pledges' && filters.bound));
  const day = (value: string | null) => (value ? date(value) : <Empty />);

  const noun = { one: t(`noun.${view}.one`), other: t(`noun.${view}.other`), dative: t(`noun.${view}.dative`) };
  const stateFilter = (values: readonly string[], kind: 'run' | 'mandate' | 'pledge') =>
    selectFilter({ key: 'state', label: t('filterState'), value: filters.state, options: values.map((s) => ({ value: s, label: ts(`${kind}.${s}`) })), onChange: (state) => apply({ state }) });
  const slots =
    view === 'runs'
      ? [frameFilter({ key: 'year', label: t('year'), value: filters.year, options: years.map((y) => ({ value: String(y), label: String(y) })), onChange: (value) => apply({ year: value }) }), stateFilter(RUN_STATES, 'run')]
      : view === 'mandates'
        ? [stateFilter(MANDATE_STATES, 'mandate')]
        : [stateFilter(PLEDGE_STATES, 'pledge'), selectFilter({ key: 'bound', label: t('filterBound'), value: filters.bound, options: [{ value: 'general', label: t('general') }, ...props.bindings], onChange: (bound) => apply({ bound }) })];

  const rows = view === 'runs' ? props.runs : view === 'mandates' ? props.mandates : props.pledges;

  return (
    <div className="flex flex-col gap-3">
      <ViewTabs
        label={t('views')}
        current={view}
        tabs={(['runs', 'mandates', 'pledges'] as const).map((key) => ({ key, label: t(`tabs.${key}`), href: hrefFor(key, filters), count: counts[key], testId: `direct-debit-tab-${key}` }))}
      />

      <FilterBar
        search={view === 'runs' ? undefined : <SearchField value={filters.text} onChange={(text) => apply({ text })} placeholder={t(`search.${view}`)} placeholderShort={t('searchShort')} />}
        searchActive={view !== 'runs' && filters.text.trim() ? { chip: filters.text.trim(), onClear: () => apply({ text: '' }) } : undefined}
        filters={slots}
        onApply={(values) => apply(values as Partial<Filters>)}
        count={{ shown: total, total: unfiltered, noun }}
        onReset={reset}
        testId="direct-debit-filters"
      />

      {rows.length === 0 && filtered ? (
        <EmptyState filtered={{ noun: t(`empty.filtered.${view}`), onReset: reset }} />
      ) : rows.length === 0 ? (
        <EmptyState title={t(`empty.${view}.title`)} text={t(`empty.${view}.text`)} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          {view === 'runs' ? <RunsTable rows={props.runs} day={day} /> : view === 'mandates' ? <MandatesTable rows={props.mandates} day={day} /> : <PledgesTable rows={props.pledges} day={day} />}
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
            testId="direct-debit-pager"
          />
        </div>
      )}
    </div>
  );
}

type Day = (value: string | null) => React.ReactNode;

function RunsTable({ rows, day }: { rows: RunRow[]; day: Day }) {
  const t = useTranslations('finance.directDebit.list');
  const ts = useTranslations('finance.directDebit.states');
  const { date } = useDateFormat();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead col="title">{t('columns.run')}</TableHead>
          <TableHead col="meta">{t('columns.items')}</TableHead>
          <TableHead col="meta">{t('columns.submittedOn')}</TableHead>
          <TableHead>{t('columns.account')}</TableHead>
          <TableHead col="amount" className="text-right">{t('columns.sum')}</TableHead>
          <TableHead col="status">{t('columns.state')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} data-testid="run-row">
            <TableCell col="title"><RowLink href={`/finance/direct-debit/runs/${r.id}`}>{t('runOn', { date: date(r.collectionDate) })}</RowLink></TableCell>
            <TableCell col="meta" className="text-ink-2">{t('itemCount', { count: r.count })}</TableCell>
            <TableCell col="meta" className="text-ink-2">{day(r.submittedOn)}</TableCell>
            <TableCell className="text-ink-2">{r.accountName}</TableCell>
            <TableCell col="amount" className="text-right tabular-nums text-ink">{formatEuro(r.sumCents)}</TableCell>
            {/* Eine Marke: Eine offene Rückgabe ist Arbeit und geht vor dem Zustand; „gebucht“ ist normal (Handoff 2a § 1.1). */}
            <TableCell col="status">
              {r.openReturns > 0 ? (
                <StatusBadge tone={statusTone('debitReturn', 'open')} dot>{ts('return.open')}</StatusBadge>
              ) : isNormalInList('debitRun', r.status) ? null : (
                <StatusBadge tone={statusTone('debitRun', r.status)} dot>{ts(`run.${r.status}`)}</StatusBadge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MandatesTable({ rows, day }: { rows: MandateRow[]; day: Day }) {
  const t = useTranslations('finance.directDebit.list');
  const ts = useTranslations('finance.directDebit.states');
  const usage = (r: MandateRow) => r.usedFor.map((kind) => t(`usedFor.${kind}`)).join(' · ');
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead col="title">{t('columns.payer')}</TableHead>
          <TableHead col="meta">{t('columns.reference')}</TableHead>
          <TableHead col="meta">{t('columns.iban')}</TableHead>
          <TableHead col="meta">{t('columns.signedOn')}</TableHead>
          <TableHead>{t('columns.usedFor')}</TableHead>
          <TableHead col="status">{t('columns.state')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          // Beendet und abgelaufen sind Endzustände: gedämpfte Zeile mit Marke am Namen (MUSTER § G, Handoff 2a § 1.1).
          const ended = r.state === 'ended' || r.state === 'expired';
          return (
            <TableRow key={r.id} data-testid="mandate-row" muted={ended ? ts(`mandate.${r.state}`) : undefined}>
              <TableCell col="title"><RowLink href={`/finance/direct-debit/mandates/${r.id}`}>{r.payer}</RowLink></TableCell>
              <TableCell col="meta" selectable className="text-ink-2">{r.reference}</TableCell>
              <TableCell col="meta" selectable className="text-ink-2">{maskIban(r.iban)}</TableCell>
              <TableCell col="meta" className="text-ink-2">{day(r.signedOn)}</TableCell>
              <TableCell className="text-ink-2">{usage(r) || <Empty />}</TableCell>
              <TableCell col="status">{ended || isNormalInList('mandate', r.state) ? null : <StatusBadge tone={statusTone('mandate', r.state)} dot>{ts(`mandate.${r.state}`)}</StatusBadge>}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function PledgesTable({ rows, day }: { rows: PledgeRow[]; day: Day }) {
  const t = useTranslations('finance.directDebit.list');
  const ts = useTranslations('finance.directDebit.states');
  const tp = useTranslations('finance.directDebit.pledge');
  // Ja/Nein-Liste: aktiv ist normal, ruhend und beendet sind gedämpft — keine Statusspalte (MUSTER § G).
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead col="title">{t('columns.name')}</TableHead>
          <TableHead col="meta">{t('columns.interval')}</TableHead>
          <TableHead col="meta">{t('columns.bound')}</TableHead>
          <TableHead col="meta">{t('columns.nextDueOn')}</TableHead>
          <TableHead>{t('columns.paymentMethod')}</TableHead>
          <TableHead col="amount" className="text-right">{t('columns.amount')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} data-testid="pledge-row" muted={r.state === 'active' ? undefined : ts(`pledge.${r.state}`)}>
            <TableCell col="title"><RowLink href={`/finance/direct-debit/pledges/${r.id}`}>{r.name}</RowLink></TableCell>
            <TableCell col="meta" className="text-ink-2">{tp(`intervals.${r.interval}`)}</TableCell>
            <TableCell col="meta" wrap className="text-ink-2">{r.bound ?? t('general')}</TableCell>
            <TableCell col="meta" className="text-ink-2">{day(r.state === 'active' ? r.nextDueOn : null)}</TableCell>
            <TableCell className="text-ink-2">{tp(`methods.${r.paymentMethod}`)}</TableCell>
            <TableCell col="amount" className="text-right tabular-nums text-ink">{formatEuro(r.amountCents)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
