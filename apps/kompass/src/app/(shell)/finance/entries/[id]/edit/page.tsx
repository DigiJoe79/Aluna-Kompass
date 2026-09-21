import { hasPermission, readSetting } from '@kompass/core';
import type { LocalizedText } from '@kompass/core';
import { getBalances, getEntry, listCategories, listOpenItems, listPurposes, TAX_CODES } from '@kompass/module-finance';
import { listProjects } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import type { ReceiptListItem } from '@/components/finance/receipt-list';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { fromEntryView } from '@/lib/finance/entry-form';
import { EntryForm } from '../../entry-form';

export default async function EditFinanceEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.entriesWrite')) return <ForbiddenCard permission="finance.entriesWrite" />;

  const entryRes = await getEntry(deps, ctx, { id });
  if (!entryRes.ok) return <ForbiddenCard permission="finance.read" />;
  const entry = entryRes.value;
  // Eine festgeschriebene Buchung hat kein Eingabefeld (Global Constraint) — die Ansicht kommt mit Task 10.
  if (entry.status !== 'draft') redirect('/finance/entries');

  const [balancesRes, categoriesRes, purposesRes, projectsRes, openItemsRes] = await Promise.all([
    getBalances(deps, ctx, {}),
    listCategories(deps, ctx, {}),
    listPurposes(deps, ctx, {}),
    listProjects(deps, ctx),
    listOpenItems(deps, ctx, { state: 'open', limit: 200 }),
  ]);

  const accounts = (balancesRes.ok ? balancesRes.value.accounts : []).map((a) => ({ id: a.accountId, name: a.name, kind: a.kind, balanceCents: a.balanceCents }));
  const categories = (categoriesRes.ok ? categoriesRes.value : [])
    .filter((c): c is typeof c & { direction: 'income' | 'expense' } => c.direction === 'income' || c.direction === 'expense')
    .map((c) => ({ id: c.id, name: c.name, direction: c.direction, sphere: c.sphere ?? 'ideal', explanation: c.explanation || undefined }));
  const purposes = (purposesRes.ok ? purposesRes.value : []).map((p) => ({ id: p.id, name: p.name }));
  const leading = deps.locales()[0] ?? 'de';
  const projects = (projectsRes.ok ? projectsRes.value : []).map((p) => ({ id: p.id, name: (p.name as LocalizedText)[leading] || p.slug }));
  const showTax = readSetting<boolean>(deps, 'finance.isEntrepreneurOrHasVatId');

  const vouchers: ReceiptListItem[] = entry.vouchers.map((v) => ({
    linkId: v.linkId,
    documentNumber: v.documentNumber,
    title: v.documentNumber,
    typeLabel: '',
    date: entry.entryDate,
    viewHref: `/finance/entries/${id}/voucher/${v.documentId}`,
    revoked: v.revokedAt !== null,
    replacedByNumber: null,
  }));

  const t = await getTranslations('finance.entryForm');
  const openItems = (openItemsRes.ok ? openItemsRes.value.items : []).map((i) => ({ id: i.id, kind: i.kind as 'receivable' | 'payable', label: i.paymentReference ?? t('settlement.unnamed', { date: i.itemDate }), openCents: i.openCents }));

  return (
    <>
      <PageHeader title={t('editTitle')} back={{ href: '/finance/entries', label: t('cancel') }} />
      <EntryForm
        initial={fromEntryView(entry)}
        accounts={accounts}
        categories={categories}
        purposes={purposes}
        projects={projects}
        taxCodeOptions={[...TAX_CODES]}
        showTax={showTax}
        canFinalize={hasPermission(ctx, 'finance.entriesFinalize')}
        voucherTypeKey="voucher-own"
        vouchers={vouchers}
        openItems={openItems}
      />
    </>
  );
}
