'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { formatDateOrDash } from '@/lib/finance/dates';
import { ItemDialog } from './item-dialog';

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
export function OpenItemsList({ rows, tab, canWrite, canCreateContact, today }: {
  rows: OpenItemRow[];
  tab: 'receivable' | 'payable';
  canWrite: boolean;
  canCreateContact: boolean;
  today: string;
}) {
  const t = useTranslations('finance.openItems');
  const router = useRouter();
  const { date } = useDateFormat();
  const [newOpen, setNewOpen] = useState(false);

  const tabHref = (next: 'receivable' | 'payable') => `/finance/open-items?tab=${next}`;

  return (
    <div className="max-w-[900px] space-y-4">
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

      <div role="tablist" aria-label={t('tabsGroup')} className="inline-flex h-[var(--field-h)] overflow-hidden rounded-md border border-line-strong">
        {(['payable', 'receivable'] as const).map((k) => (
          <Link
            key={k}
            href={tabHref(k)}
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'bg-selected px-3 py-1.5 text-[13px] font-semibold text-selected-ink' : 'bg-surface-2 px-3 py-1.5 text-[13px] text-ink-2'}
          >
            {t(`tabs.${k}`)}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t('empty.title')} text={t('empty.text')} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader className="bg-table-head text-left text-[11px] font-bold uppercase tracking-[.06em] text-muted-ink">
              <TableRow className="h-9">
                <TableHead className="px-4">{t('columns.dueOn')}</TableHead>
                <TableHead className="px-4">{t('columns.contact')}</TableHead>
                <TableHead className="px-4">{t('columns.amount')}</TableHead>
                <TableHead className="px-4">{t('columns.open')}</TableHead>
                <TableHead className="px-4">{t('columns.origin')}</TableHead>
                <TableHead className="px-4">{t('columns.reference')}</TableHead>
                <TableHead className="px-4">{t('columns.state')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  tabIndex={0}
                  onClick={() => router.push(`/finance/open-items?tab=${tab}&item=${row.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') router.push(`/finance/open-items?tab=${tab}&item=${row.id}`);
                  }}
                  className="h-row cursor-pointer border-b border-line-2 hover:bg-row-hover"
                >
                  <TableCell className={row.overdue ? 'px-4 font-semibold text-error' : 'px-4'}>{formatDateOrDash(date, row.dueOn)}</TableCell>
                  <TableCell className="px-4">{row.contactLabel ?? '—'}</TableCell>
                  <TableCell className="px-4 font-mono tabular-nums">{formatEuro(row.amountCents)}</TableCell>
                  <TableCell className="px-4 font-mono tabular-nums">{formatEuro(row.openCents)}</TableCell>
                  <TableCell className="px-4">{row.hasOrigin ? t('hasOrigin') : '—'}</TableCell>
                  <TableCell className="px-4">{row.paymentReference ?? '—'}</TableCell>
                  <TableCell className="px-4">
                    {t(`state.${row.word}`)}
                    {row.overdue ? ` · ${row.draftSettlementCents > 0 ? t('draftSettlement') : t('overdue')}` : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {newOpen ? (
        <ItemDialog open={newOpen} onOpenChange={setNewOpen} item={null} defaultKind={tab} canCreateContact={canCreateContact} today={today} />
      ) : null}
    </div>
  );
}
