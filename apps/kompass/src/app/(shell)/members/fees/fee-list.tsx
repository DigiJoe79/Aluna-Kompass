'use client';

import type { FeeView } from '@kompass/module-members';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { Empty } from '@/components/empty-value';
import { FilterBar, frameFilter, selectFilter } from '@/components/filter-bar';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { ListPager } from '@/components/list-pager';
import { Overline } from '@/components/overline';
import { RowMenu } from '@/components/row-menu';
import { SearchField } from '@/components/search-field';
import { StatusBadge, isNormalInList, statusTone } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { RowLink, Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { useUrlFilters } from '@/lib/use-url-filters';
import { deferChargeAction, waiveChargeAction } from '../actions';

const STATES = ['open', 'partlyPaid', 'paid', 'waived', 'overdue'] as const;
type Filters = { text: string; state: string; type: string };

export interface FeeListProps {
  year: number;
  years: number[];
  rows: FeeView[];
  total: number;
  unfiltered: number;
  offset: number;
  pageSize: number;
  totals: { dueCents: number; paidCents: number; openCents: number; dunnedCents: number };
  /** Beitragsfreie Mitglieder des Jahres je Art (Handoff 2.4, „Ohne Beitrag“). */
  exempt: { typeId: string; count: number }[];
  types: { id: string; name: string }[];
  levels: { key: string; name: string; last: boolean }[];
  canFees: boolean;
  today: string;
}

/**
 * Beiträge eines Jahres (Handoff Mitglieder 2.4, 4a/4b, D8): Jahr vorn in der Filterleiste als Rahmen (wie das
 * Spendenbuch), Summenkasten Soll · Bezahlt · Offen · Davon gemahnt, eine Zeile je Beitrag mit Unterzeile, wenn der
 * Rhythmus mehrere Zeiträume hat; Summe im Tabellenfuß. Stunden und Erlassen im Zeilenmenü, nur mit `members.fees`.
 */
export function FeeList({ year, years, rows, total, unfiltered, offset, pageSize, totals, exempt, types, levels, canFees, today }: FeeListProps) {
  const t = useTranslations('members.fees');
  const { date } = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [defer, setDefer] = useState<FeeView | null>(null);
  const [deferOn, setDeferOn] = useState('');
  const [waive, setWaive] = useState<FeeView | null>(null);
  const [filters, setFilters] = useUrlFilters<Filters>({ text: params.get('text') ?? '', state: params.get('state') ?? '', type: params.get('type') ?? '' });

  const go = (next: Filters & { year: number }) => {
    const qs = new URLSearchParams();
    qs.set('year', String(next.year));
    if (next.text.trim()) qs.set('text', next.text.trim());
    if (next.state) qs.set('state', next.state);
    if (next.type) qs.set('type', next.type);
    startTransition(() => router.replace(`${pathname}?${qs.toString()}`));
  };
  const apply = (patch: Partial<Filters>) => {
    const merged = { ...filters, ...patch };
    setFilters(merged);
    go({ ...merged, year });
  };
  const reset = () => apply({ text: '', state: '', type: '' });
  const filtered = Boolean(filters.text.trim() || filters.state || filters.type);
  const typeName = (id: string) => types.find((ty) => ty.id === id)?.name ?? '';

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        search={<SearchField value={filters.text} onChange={(text) => apply({ text })} placeholder={t('search')} placeholderShort={t('searchShort')} />}
        searchActive={filters.text.trim() ? { chip: filters.text.trim(), onClear: () => apply({ text: '' }) } : undefined}
        filters={[
          // Das Jahr grenzt den Bestand ab, ist kein gesetzter Filter (MUSTER § L, wie das Spendenbuch).
          frameFilter({ key: 'year', label: t('year'), value: String(year), options: years.map((y) => ({ value: String(y), label: String(y) })), onChange: (value) => go({ ...filters, year: Number(value) }) }),
          selectFilter({ key: 'state', label: t('filterState'), value: filters.state, options: STATES.map((s) => ({ value: s, label: t(`state.${s}`) })), onChange: (state) => apply({ state }) }),
          selectFilter({ key: 'type', label: t('filterType'), value: filters.type, options: types.map((ty) => ({ value: ty.id, label: ty.name })), onChange: (type) => apply({ type }) }),
        ]}
        onApply={(values) => {
          const { year: nextYear, ...rest } = values;
          const merged = { ...filters, ...(rest as Partial<Filters>) };
          setFilters(merged);
          go({ ...merged, year: nextYear ? Number(nextYear) : year });
        }}
        count={{ shown: total, total: unfiltered, noun: { one: t('noun.one'), other: t('noun.other'), dative: t('noun.dative') } }}
        onReset={reset}
        testId="fees-filters"
      />

      <div data-testid="fees-sums" className="flex flex-wrap gap-x-8 gap-y-2 rounded-md border border-line bg-surface p-4">
        {(['due', 'paid', 'open', 'dunned'] as const).map((kind) => (
          <span key={kind} className="flex flex-col">
            <Overline as="span">{t(`sums.${kind}`)}</Overline>
            <span data-testid={`fees-sum-${kind}`} className="text-section tabular-nums text-ink">{formatEuro(totals[`${kind}Cents`])}</span>
          </span>
        ))}
        {exempt.length > 0 ? (
          <p data-testid="fees-exempt" className="basis-full text-hint text-muted-ink">
            {t('exemptLine', { list: exempt.map((e) => t('exemptPart', { count: e.count, type: typeName(e.typeId) })).join(', ') })}
          </p>
        ) : null}
      </div>

      {rows.length === 0 && filtered ? (
        <EmptyState filtered={{ noun: t('empty.filteredNoun'), onReset: reset }} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead col="title">{t('columns.member')}</TableHead>
                <TableHead>{t('columns.type')}</TableHead>
                <TableHead col="meta">{t('columns.due')}</TableHead>
                <TableHead className="text-right">{t('columns.amount')}</TableHead>
                <TableHead className="text-right">{t('columns.paid')}</TableHead>
                <TableHead col="amount" className="text-right">{t('columns.open')}</TableHead>
                <TableHead col="status">{t('columns.state')}</TableHead>
                {canFees ? <TableHead col="actions"><span className="sr-only">{t('columns.actions')}</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((f) => {
                const level = f.dunningLevel ? levels.find((l) => l.key === f.dunningLevel) : undefined;
                const open = f.openCents > 0 && f.state !== 'waived';
                return (
                  <TableRow key={f.chargeId} data-testid="fee-row">
                    <TableCell col="title">
                      <span className="flex flex-col">
                        <RowLink href={`/members/${f.membershipId}`}>{f.name}</RowLink>
                        {f.period !== String(year) ? <span className="text-hint text-muted-ink tabular-nums">{f.period}</span> : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-ink-2">{typeName(f.typeId)}</TableCell>
                    <TableCell col="meta" className="text-ink-2">{date(f.dueOn)}</TableCell>
                    <TableCell className="text-right tabular-nums text-ink-2">{formatEuro(f.amountCents)}</TableCell>
                    <TableCell className="text-right tabular-nums text-ink-2">{formatEuro(f.paidCents)}</TableCell>
                    <TableCell col="amount" className="text-right tabular-nums text-ink">{open ? formatEuro(f.openCents) : <Empty />}</TableCell>
                    <TableCell col="status">
                      {!isNormalInList('fee', f.state) || level || f.overdue ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {isNormalInList('fee', f.state) ? null : <StatusBadge tone={statusTone('fee', f.state)} dot>{t(`state.${f.state}`)}</StatusBadge>}
                          {level ? (
                            <StatusBadge tone={statusTone('dunning', level.last ? 'lastLevel' : 'level')} dot>{level.name}</StatusBadge>
                          ) : f.overdue ? (
                            <StatusBadge tone={statusTone('fee', 'overdue')} dot>{t('state.overdue')}</StatusBadge>
                          ) : null}
                        </span>
                      ) : null}
                    </TableCell>
                    {canFees ? (
                      <TableCell col="actions" className="text-right">
                        {open ? (
                          <RowMenu
                            name={`${f.name} ${f.period}`}
                            items={[
                              { key: 'defer', label: t('row.defer'), onSelect: () => { setDeferOn(f.dueOn > today ? f.dueOn : today); setDefer(f); } },
                              { key: 'waive', label: t('row.waive'), onSelect: () => setWaive(f) },
                            ]}
                          />
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter className="border-t border-line-strong bg-surface-2">
              <TableRow>
                <TableCell col="span" colSpan={canFees ? 8 : 7} className="w-full text-hint">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-muted-ink">{t('total')}</span>
                    <span className="ml-auto text-right tabular-nums text-ink-2" data-testid="fees-total">
                      {t('totalLine', { due: formatEuro(totals.dueCents), paid: formatEuro(totals.paidCents), open: formatEuro(totals.openCents) })}
                    </span>
                  </span>
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <ListPager
            total={total}
            offset={offset}
            pageSize={pageSize}
            hrefFor={(next) => {
              const qs = new URLSearchParams(params.toString());
              const target = Math.floor(next / pageSize) + 1;
              if (target > 1) qs.set('page', String(target));
              else qs.delete('page');
              return `${pathname}?${qs.toString()}`;
            }}
            footer
            testId="fees-pager"
          />
        </div>
      )}

      <ConfirmDialog
        open={defer !== null}
        onOpenChange={(open) => (open ? undefined : setDefer(null))}
        role="dialog"
        title={t('defer.title')}
        description={defer ? t('defer.description', { period: defer.period, name: defer.name }) : ''}
        confirmLabel={t('defer.confirm')}
        confirmDisabled={!deferOn}
        action={async () => {
          const result = await deferChargeAction({ chargeId: defer!.chargeId, dueOn: deferOn });
          if (result.status === 'success') {
            toast.success(result.message);
            router.refresh();
          }
          return result;
        }}
      >
        <FormGrid>
          <FormField id="defer-date" label={t('defer.dueOn')} required size="s">
            <Input id="defer-date" type="date" value={deferOn} onChange={(e) => setDeferOn(e.target.value)} />
          </FormField>
        </FormGrid>
      </ConfirmDialog>
      <ConfirmDialog
        open={waive !== null}
        onOpenChange={(open) => (open ? undefined : setWaive(null))}
        title={t('waive.title')}
        description={waive ? t('waive.description', { period: waive.period, name: waive.name, amount: formatEuro(waive.openCents) }) : ''}
        confirmLabel={t('waive.confirm')}
        destructive
        action={async () => {
          const result = await waiveChargeAction(waive!.chargeId);
          if (result.status === 'success') {
            toast.success(result.message);
            router.refresh();
          }
          return result;
        }}
      />
    </div>
  );
}
