import { hasPermission } from '@kompass/core';
import { documentTypeFor } from '@kompass/module-dms';
import { listVouchersWithoutEntry } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ListPager } from '@/components/list-pager';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireSession } from '@/lib/request-context';
import { VoucherRows } from './voucher-rows';

/**
 * „Belege ohne Buchung“ (F5 Task 8, Spec 6.5): Finanzbelege der Akte, die an
 * keiner Buchung hängen — je mit „Zu Buchung machen“. Was der Betrachter in
 * der Akte nicht lesen darf, fehlt (die Akte prüft). Je Zeile klappt die
 * Karte „Aus der Rechnung“ auf (F5b), wenn das PDF eine ZUGFeRD-Rechnung trägt.
 */
/** Belege je Seite (MUSTER § L) — bis 0.2.8 eine stille Grenze bei 200. */
const PAGE_SIZE = 50;

export default async function FinanceVouchersWithoutEntryPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <Page width="full"><ForbiddenCard permission="finance.read" /></Page>;
  const t = await getTranslations('finance.work');
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const result = await listVouchersWithoutEntry(deps, ctx, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  if (!result.ok) return <Page width="full"><ForbiddenCard permission="finance.read" /></Page>;
  const documents = result.value.documents;
  const canWrite = hasPermission(ctx, 'finance.entriesWrite');
  const canOpenDocument = hasPermission(ctx, 'dms.view');

  return (
    <Page width="full">
      <div className="space-y-4">
        <PageHeader title={t('pages.vouchers.title')} description={t('pages.vouchers.description')} />
        {documents.length === 0 && page === 1 ? (
          <EmptyState title={t('pages.vouchers.empty')} text={t('pages.vouchers.emptyText')} />
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('pages.vouchers.number')}</TableHead>
                  <TableHead>{t('pages.vouchers.subject')}</TableHead>
                  <TableHead>{t('pages.vouchers.date')}</TableHead>
                  <TableHead>{t('pages.vouchers.type')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                <VoucherRows
                  rows={documents.map((doc) => ({ id: doc.id, number: doc.number, subject: doc.subject, documentDate: doc.documentDate, typeLabel: documentTypeFor(deps.db, doc.typeKey)?.label ?? doc.typeKey }))}
                  canOpenDocument={canOpenDocument}
                  canWrite={canWrite}
                  canCreateContact={hasPermission(ctx, 'contacts.manage')}
                />
              </TableBody>
            </Table>
            <ListPager
              total={result.value.total}
              offset={(page - 1) * PAGE_SIZE}
              pageSize={PAGE_SIZE}
              hrefFor={(next) => (next > 0 ? `/finance/work/vouchers?page=${Math.floor(next / PAGE_SIZE) + 1}` : '/finance/work/vouchers')}
              footer
              testId="vouchers-pager"
            />
          </div>
        )}
      </div>
    </Page>
  );
}
