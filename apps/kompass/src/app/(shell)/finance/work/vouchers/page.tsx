import { hasPermission } from '@kompass/core';
import { documentTypeFor } from '@kompass/module-dms';
import { listVouchersWithoutEntry } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireSession } from '@/lib/request-context';

/**
 * „Belege ohne Buchung“ (F5 Task 8, Spec 6.5): Finanzbelege der Akte, die an
 * keiner Buchung hängen — je mit „Zu Buchung machen“. Was der Betrachter in
 * der Akte nicht lesen darf, fehlt (die Akte prüft).
 */
export default async function FinanceVouchersWithoutEntryPage() {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;
  const t = await getTranslations('finance.work');
  const result = await listVouchersWithoutEntry(deps, ctx, { limit: 200 });
  if (!result.ok) return <ForbiddenCard permission="finance.read" />;
  const documents = result.value.documents;
  const canWrite = hasPermission(ctx, 'finance.entriesWrite');
  const canOpenDocument = hasPermission(ctx, 'dms.view');

  return (
    <div className="space-y-4">
      <PageHeader title={t('pages.vouchers.title')} description={t('pages.vouchers.description')} />
      {documents.length === 0 ? (
        <EmptyState title={t('pages.vouchers.empty')} text={t('pages.vouchers.emptyText')} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
              <TableRow className="h-9">
                <TableHead className="px-4">{t('pages.vouchers.number')}</TableHead>
                <TableHead className="px-4">{t('pages.vouchers.subject')}</TableHead>
                <TableHead className="px-4">{t('pages.vouchers.date')}</TableHead>
                <TableHead className="px-4">{t('pages.vouchers.type')}</TableHead>
                <TableHead className="px-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id} className="h-11 border-b border-line-2">
                  <TableCell className="px-4 font-mono text-[12px] text-ink-2">{doc.number}</TableCell>
                  <TableCell className="px-4 font-medium text-ink">
                    {canOpenDocument ? (
                      <Link href={`/dms/${doc.id}`} className="underline underline-offset-2">
                        {doc.subject}
                      </Link>
                    ) : (
                      doc.subject
                    )}
                  </TableCell>
                  <TableCell className="px-4 font-mono text-[12px] tabular-nums text-ink-2">{doc.documentDate}</TableCell>
                  <TableCell className="px-4 text-ink-2">{documentTypeFor(deps.db, doc.typeKey)?.label ?? doc.typeKey}</TableCell>
                  <TableCell className="px-4 text-right">
                    {canWrite ? (
                      <Link href={`/finance/entries/new?voucher=${doc.id}`} className={buttonVariants({ size: 'sm', variant: 'secondary' })}>
                        {t('toEntry')}
                      </Link>
                    ) : null}
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
