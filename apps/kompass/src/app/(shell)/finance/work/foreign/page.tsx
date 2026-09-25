import { hasPermission, readSetting } from '@kompass/core';
import { listForeignMoney } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate, type DateFormatMode } from '@/lib/dates';
import { formatEuro } from '@/lib/finance/amount';
import { requireSession } from '@/lib/request-context';
import { PassedOnButton } from './passed-on-button';

/**
 * „Fremdes Geld, noch nicht weitergegeben“ (F5 Task 8, Annahme 4): Eingänge
 * auf „Gehört nicht dem Verein“, zu denen noch keine Rückzahlung gebucht ist.
 * Nebenliste unter ARBEIT, ohne Zähler.
 */
export default async function FinanceForeignMoneyPage() {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;
  const t = await getTranslations('finance.work.pages.foreign');
  const dateMode = readSetting<DateFormatMode>(deps, 'ui.dateFormat');
  const result = await listForeignMoney(deps, ctx);
  if (!result.ok) return <ForbiddenCard permission="finance.read" />;
  const items = result.value.items;

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('description')} />
      {items.length === 0 ? (
        <EmptyState title={t('empty')} text={t('emptyText')} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="h-9">
                <TableHead className="px-4">{t('date')}</TableHead>
                <TableHead className="px-4">{t('holder')}</TableHead>
                <TableHead className="px-4 text-right">{t('amount')}</TableHead>
                <TableHead className="px-4">{t('entry')}</TableHead>
                <TableHead className="px-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.lineId} className="h-11 border-b border-line-2">
                  <TableCell className="px-4 font-mono text-[12px] tabular-nums text-ink-2">{formatDate(item.entryDate, dateMode)}</TableCell>
                  <TableCell className="px-4 font-medium text-ink">{item.holderText}</TableCell>
                  <TableCell className="px-4 text-right font-mono tabular-nums">{formatEuro(item.amountCents)}</TableCell>
                  <TableCell className="px-4">
                    <Link href={`/finance/entries/${item.entryId}`} className="font-mono text-[12px] underline underline-offset-2">
                      {item.entryNumber ?? t('draft')}
                    </Link>
                  </TableCell>
                  <TableCell className="px-4 text-right">
                    <PassedOnButton holder={item.holderText} amount={formatEuro(item.amountCents)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
