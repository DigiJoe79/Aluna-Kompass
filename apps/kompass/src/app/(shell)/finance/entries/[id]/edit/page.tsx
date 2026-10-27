import { hasPermission, todayIn } from '@kompass/core';
import type { LocalizedText } from '@kompass/core';
import { getBalances, getContactTaxDetails, getEntry, listCategories, listOpenItems, listPurposes, taxCodeOptionsInternal, vatLineContextInternal } from '@kompass/module-finance';
import { listProjects } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import type { ReceiptListItem } from '@/components/finance/receipt-list';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { readAllPages } from '@/lib/read-all-pages';
import { requireSession } from '@/lib/request-context';
import { contactOriginOf, fromEntryView } from '@/lib/finance/entry-form';
import { isReverseChargeCode } from '@/lib/finance/reverse-charge-text';
import { settlementOptions } from '@/lib/finance/open-item-options';
import { voucherDetails } from '@/lib/finance/voucher-details';
import { EntryForm } from '../../entry-form';

export default async function EditFinanceEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.entriesWrite')) return <Page width="standard"><ForbiddenCard permission="finance.entriesWrite" /></Page>;

  const entryRes = await getEntry(deps, ctx, { id });
  if (!entryRes.ok) return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  const entry = entryRes.value;
  // Eine festgeschriebene Buchung hat kein Eingabefeld (Global Constraint) — die Ansicht kommt mit Task 10.
  if (entry.status !== 'draft') redirect('/finance/entries');

  const [balancesRes, categoriesRes, purposesRes, projectsRes, openItemsRes] = await Promise.all([
    getBalances(deps, ctx, {}),
    listCategories(deps, ctx, {}),
    listPurposes(deps, ctx, {}),
    listProjects(deps, ctx),
    // Alle offenen Posten: Die Auswahl „Ausgleich“ sucht auf dem Rechner und muss jeden anbieten (keine stille Grenze).
    readAllPages((page) => listOpenItems(deps, ctx, { state: 'open', ...page }), (v) => v.items),
  ]);

  const accounts = (balancesRes.ok ? balancesRes.value.accounts : []).map((a) => ({ id: a.accountId, name: a.name, kind: a.kind, balanceCents: a.balanceCents }));
  const categories = (categoriesRes.ok ? categoriesRes.value : [])
    .filter((c): c is typeof c & { direction: 'income' | 'expense' } => c.direction === 'income' || c.direction === 'expense')
    .map((c) => ({ id: c.id, name: c.name, direction: c.direction, sphere: c.sphere ?? 'ideal', incomeKind: c.incomeKind ?? null, explanation: c.explanation || undefined }));
  const purposes = (purposesRes.ok ? purposesRes.value : []).map((p) => ({ id: p.id, name: p.name }));
  const leading = deps.locales()[0] ?? 'de';
  const projects = (projectsRes.ok ? projectsRes.value : []).map((p) => ({ id: p.id, name: (p.name as LocalizedText)[leading] || p.slug }));
  const taxCodes = taxCodeOptionsInternal(deps.db, todayIn(deps));
  const showTax = taxCodes.length > 0;

  // 07-2 A5: Nummer einmal, daneben der Betreff aus der Akte.
  const voucherDocs = await voucherDetails(deps, ctx, entry.vouchers.map((v) => v.documentId));
  const vouchers: ReceiptListItem[] = entry.vouchers.map((v) => ({
    linkId: v.linkId,
    documentNumber: v.documentNumber,
    title: voucherDocs.get(v.documentId)?.subject ?? '',
    typeLabel: voucherDocs.get(v.documentId)?.typeLabel ?? '',
    date: voucherDocs.get(v.documentId)?.date ?? entry.entryDate,
    viewHref: `/finance/entries/${id}/voucher/${v.documentId}`,
    documentId: v.documentId,
    revoked: v.revokedAt !== null,
    replacedByNumber: null,
  }));

  // E6a Task 11c: Entspricht das Kennzeichen dem Merkmal § 13b des Kontakts, steht „Vorgabe vom Kontakt“ darunter.
  const loaded = fromEntryView(entry);
  const reverseChargeOf = new Map<string, 'eu' | 'other' | null>();
  for (const contactId of new Set(loaded.splitRows.filter((r) => r.contactId && isReverseChargeCode(r.taxCode)).map((r) => r.contactId!))) {
    const details = await getContactTaxDetails(deps, ctx, { contactId });
    reverseChargeOf.set(contactId, details.ok ? (details.value?.reverseCharge ?? null) : null);
  }
  const initial = { ...loaded, splitRows: loaded.splitRows.map((r) => (r.contactId && reverseChargeOf.has(r.contactId) ? { ...r, taxCodeOrigin: contactOriginOf(r.taxCode, reverseChargeOf.get(r.contactId) ?? null) } : r)) };

  const t = await getTranslations('finance.entryForm');
  const openItems = await settlementOptions(deps, ctx, openItemsRes.ok ? openItemsRes.value : [], (date) => t('settlement.unnamed', { date }));

  return (
    <Page width="standard" header={<PageHeader title={t('editTitle')} back={{ href: '/finance/entries', label: t('cancel') }} />}>
      <EntryForm
        today={todayIn(deps)}
        initial={initial}
        accounts={accounts}
        categories={categories}
        purposes={purposes}
        projects={projects}
        taxCodeOptions={taxCodes}
        showTax={showTax}
        vatContext={vatLineContextInternal(deps.db, todayIn(deps))}
        canFinalize={hasPermission(ctx, 'finance.entriesFinalize')}
        voucherTypeKey="voucher-own"
        vouchers={vouchers}
        openItems={openItems}
      />
    </Page>
  );
}
