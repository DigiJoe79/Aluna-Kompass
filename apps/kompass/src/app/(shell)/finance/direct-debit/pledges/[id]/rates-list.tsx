'use client';

import type { PledgeRate } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { Empty } from '@/components/empty-value';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { StatusBadge, isNormalInList, statusTone } from '@/components/status-badge';
import { Disclosure } from '@/components/ui/disclosure';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { ReturnDialog, type OpenReturn } from '../../return-dialog';

/**
 * Raten einer Zusage (Nachtrag Phase 2 § 1): berechnet, neueste zuerst. Eine gebuchte Rate verlinkt ihre Buchung (Nummer
 * als Unterzeile), eine nicht gebuchte ist Text. „erwartet“ trägt hier eine Marke, „gebucht“ nicht; eine zurückgegebene
 * Rate mit „erneut einziehen“ hat die Unterzeile „wird erneut eingezogen“, eine offene Rückgabe „Rückgabe klären …“.
 */
export function RatesList({ intro, current, older, openReturns, canResolve }: { intro: string; current: PledgeRate[]; older: PledgeRate[]; openReturns: OpenReturn[]; canResolve: boolean }) {
  const t = useTranslations('finance.directDebit.pledge');
  const [resolving, setResolving] = useState<OpenReturn | null>(null);
  const years = [...new Set(older.map((r) => r.dueOn.slice(0, 4)))];
  return (
    <div className="space-y-3">
      <Section title={t('rates')} intro={intro}>
        <div className="space-y-3">
          {current.length > 0 ? (
            <RatesTable rates={current} openReturns={openReturns} canResolve={canResolve} onResolve={setResolving} />
          ) : (
            <p className="text-meta text-muted-ink">{t('ratesEmpty')}</p>
          )}
          {years.map((year) => {
            const rates = older.filter((r) => r.dueOn.startsWith(year));
            return (
              <Disclosure key={year} label={t('ratesYear', { year, count: rates.length })}>
                <RatesTable rates={rates} openReturns={openReturns} canResolve={canResolve} onResolve={setResolving} />
              </Disclosure>
            );
          })}
          <p className="text-hint text-muted-ink">{t('ratesNote')}</p>
        </div>
      </Section>
      {resolving ? <ReturnDialog item={resolving} onClose={() => setResolving(null)} /> : null}
    </div>
  );
}

function RatesTable({ rates, openReturns, canResolve, onResolve }: { rates: PledgeRate[]; openReturns: OpenReturn[]; canResolve: boolean; onResolve: (item: OpenReturn) => void }) {
  const t = useTranslations('finance.directDebit.pledge');
  const ts = useTranslations('finance.directDebit.states');
  const tl = useTranslations('finance.directDebit.list');
  const { date } = useDateFormat();
  const openOf = (r: PledgeRate) => openReturns.find((o) => o.id === r.returnId);
  const resolvable = canResolve && rates.some((r) => openOf(r));
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead col="title">{t('columns.dueOn')}</TableHead>
            <TableHead col="amount" className="text-right">{t('columns.amount')}</TableHead>
            <TableHead col="meta">{t('columns.run')}</TableHead>
            <TableHead col="status">{t('columns.state')}</TableHead>
            {resolvable ? <TableHead col="actions"><span className="sr-only">{t('columns.actions')}</span></TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rates.map((r) => (
            <TableRow key={r.dueOn} data-testid="pledge-rate">
              <TableCell col="title">
                {r.state === 'booked' && r.entryId ? (
                  <span className="flex flex-col">
                    <RowLink href={`/finance/entries/${r.entryId}`}>{date(r.dueOn)}</RowLink>
                    <span className="text-hint text-muted-ink">{t('entry', { number: r.entryNumber ?? '' })}</span>
                  </span>
                ) : (
                  <span className="flex flex-col">
                    {date(r.dueOn)}
                    {r.recollect ? <span className="text-hint text-muted-ink">{t('recollect')}</span> : null}
                    {r.transfer ? <span className="text-hint text-muted-ink">{t('byTransfer')}</span> : null}
                  </span>
                )}
              </TableCell>
              <TableCell col="amount" className="text-right tabular-nums text-ink">{formatEuro(r.amountCents)}</TableCell>
              <TableCell col="meta" className="text-ink-2">{r.run ? tl('runOn', { date: date(r.run.collectionDate) }) : <Empty />}</TableCell>
              <TableCell col="status">{isNormalInList('pledgeRate', r.state) ? null : <StatusBadge tone={statusTone('pledgeRate', r.state)} dot>{ts(`rate.${r.state}`)}</StatusBadge>}</TableCell>
              {resolvable ? (
                <TableCell col="actions">
                  {openOf(r) ? <RowMenu name={date(r.dueOn)} items={[{ key: 'resolve', label: t('resolveReturn'), onSelect: () => onResolve(openOf(r)!), testId: 'rate-resolve' }]} /> : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
