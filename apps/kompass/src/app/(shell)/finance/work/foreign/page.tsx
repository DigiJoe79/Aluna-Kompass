import { hasPermission } from '@kompass/core';
import { listForeignMoney } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { dateFormatOf } from '@/lib/date-format';
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
  const tCommon = await getTranslations('common');
  const fmt = dateFormatOf(deps);
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
                  <TableHead col="meta">{t('date')}</TableHead>
                  <TableHead col="title">{t('holder')}</TableHead>
                  <TableHead col="amount" className="text-right">{t('amount')}</TableHead>
                  <TableHead col="meta">{t('entry')}</TableHead>
                  <TableHead col="actions"><span className="sr-only">{tCommon('rowActionsColumn')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.lineId}>
                    <TableCell col="meta" className="text-hint tabular-nums text-ink-2">{fmt.date(item.entryDate)}</TableCell>
                    <TableCell col="title" truncate className="text-ink">{item.holderText}</TableCell>
                    <TableCell col="amount" className="text-right tabular-nums">
                      {formatEuro(item.openCents)}
                      {item.passedOnCents > 0 && (
                        <span className="block text-hint text-muted-ink" data-testid="foreign-partly-passed-on">
                          {t('partlyPassedOn', { amount: formatEuro(item.amountCents), passedOn: formatEuro(item.passedOnCents) })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell col="meta">
                      {/* 07-1 C39: Nur die Nummer ist eine Kennung (Mono); „Entwurf“ steht in der Textschrift. */}
                      <Link href={`/finance/entries/${item.entryId}`} className="text-hint underline underline-offset-2">
                        {/* Runde 3, 074: Ein Entwurf hat keine Nummer — der Link sagt, wohin er führt, statt einen Zustand zu zeigen. */}
                        {item.entryNumber ? <span className="font-mono">{item.entryNumber}</span> : t('openEntry')}
                      </Link>
                    </TableCell>
                    <TableCell col="actions" className="text-right">
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
