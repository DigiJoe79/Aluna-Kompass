import { hasPermission, readSetting } from '@kompass/core';
import { listForeignMoney } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate, type DateFormatMode } from '@/lib/dates';
import { formatEuro } from '@/lib/finance/amount';
import { requireSession } from '@/lib/request-context';
import { PassedOnButton } from './passed-on-button';

/**
 * „Fremdes Geld, noch nicht weitergegeben“ (F5 Task 8, Annahme 4): Eingänge
 * auf „Gehört nicht dem Verein“, die noch nicht vollständig weitergegeben sind
 * — mit dem offenen Rest (AF).
 * Nebenliste unter ARBEIT, ohne Zähler.
 */
export default async function FinanceForeignMoneyPage() {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <Page width="full"><ForbiddenCard permission="finance.read" /></Page>;
  const t = await getTranslations('finance.work.pages.foreign');
  const dateMode = readSetting<DateFormatMode>(deps, 'ui.dateFormat');
  const result = await listForeignMoney(deps, ctx);
  if (!result.ok) return <Page width="full"><ForbiddenCard permission="finance.read" /></Page>;
  const items = result.value.items;

  return (
    <Page width="full">
      <div className="space-y-4">
        <PageHeader title={t('title')} description={t('description')} />
        {items.length === 0 ? (
          <EmptyState title={t('empty')} text={t('emptyText')} />
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('date')}</TableHead>
                  <TableHead>{t('holder')}</TableHead>
                  <TableHead className="text-right">{t('amount')}</TableHead>
                  <TableHead>{t('entry')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.lineId}>
                    <TableCell className="font-mono text-[12px] tabular-nums text-ink-2">{formatDate(item.entryDate, dateMode)}</TableCell>
                    <TableCell className="font-medium text-ink">{item.holderText}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatEuro(item.openCents)}
                      {item.passedOnCents > 0 && (
                        <span className="block text-[11px] text-muted-ink" data-testid="foreign-partly-passed-on">
                          {t('partlyPassedOn', { amount: formatEuro(item.amountCents), passedOn: formatEuro(item.passedOnCents) })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link href={`/finance/entries/${item.entryId}`} className="font-mono text-[12px] underline underline-offset-2">
                        {item.entryNumber ?? t('draft')}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <PassedOnButton holder={item.holderText} amount={formatEuro(item.openCents)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Page>
  );
}
