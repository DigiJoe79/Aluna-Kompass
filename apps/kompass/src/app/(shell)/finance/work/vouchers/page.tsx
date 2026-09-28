import { hasPermission } from '@kompass/core';
import { documentTypeFor } from '@kompass/module-dms';
import { listVouchersWithoutEntry } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
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
            <TableHeader>
              <TableRow className="h-9">
                <TableHead className="px-4">{t('pages.vouchers.number')}</TableHead>
                <TableHead className="px-4">{t('pages.vouchers.subject')}</TableHead>
                <TableHead className="px-4">{t('pages.vouchers.date')}</TableHead>
                <TableHead className="px-4">{t('pages.vouchers.type')}</TableHead>
                <TableHead className="px-4" />
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
        </div>
      )}
    </div>
  );
}
