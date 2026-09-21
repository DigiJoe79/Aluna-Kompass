import { hasPermission, readSetting } from '@kompass/core';
import type { LocalizedText } from '@kompass/core';
import { getBalances, listCategories, listOpenItems, listPurposes, TAX_CODES } from '@kompass/module-finance';
import { listProjects } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { formatAmount } from '@/lib/finance/amount';
import { emptyForm, type EntryTemplate } from '@/lib/finance/entry-form';
import { EntryForm } from '../entry-form';

export default async function NewFinanceEntryPage({ searchParams }: { searchParams: Promise<{ template?: string; account?: string; settles?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.entriesWrite')) return <ForbiddenCard permission="finance.entriesWrite" />;

  const query = await searchParams;
  const template: EntryTemplate = (['income', 'expense', 'transfer', 'inKind'] as const).includes(query.template as never) ? (query.template as EntryTemplate) : 'expense';
  const today = deps.clock.now().toISOString().slice(0, 10);

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
  const t = await getTranslations('finance.entryForm');
  const openItems = (openItemsRes.ok ? openItemsRes.value.items : []).map((i) => ({ id: i.id, kind: i.kind as 'receivable' | 'payable', label: i.paymentReference ?? t('settlement.unnamed', { date: i.itemDate }), openCents: i.openCents }));

  // `?account=` belegt das Konto der ersten Geldzeile vor — von der Barkasse aus „Bar bezahlt“ (F3b Task 2).
  const initial = emptyForm(template, today);
  const accountId = query.account && accounts.some((a) => a.id === query.account) ? query.account : null;
  if (accountId && initial.moneyRows[0]) initial.moneyRows[0] = { ...initial.moneyRows[0], accountId };

  // `?settles=` — „Jetzt buchen“ von einer offenen Zahlung aus (F3b Task 3, A6): Richtung folgt schon aus
  // der Vorlage (income/expense), Betrag und Begleichung sind der Rest des Postens.
  const settlingItem = query.settles ? openItems.find((i) => i.id === query.settles) : undefined;
  if (settlingItem && initial.moneyRows[0]) {
    initial.moneyRows[0] = {
      ...initial.moneyRows[0],
      amountText: formatAmount(settlingItem.openCents),
      settlements: [{ openItemId: settlingItem.id, amountText: formatAmount(settlingItem.openCents) }],
    };
  }

  return (
    <>
      <PageHeader title={t('newTitle')} back={{ href: '/finance/entries', label: t('cancel') }} />
      <EntryForm
        initial={initial}
        accounts={accounts}
        categories={categories}
        purposes={purposes}
        projects={projects}
        taxCodeOptions={[...TAX_CODES]}
        showTax={showTax}
        canFinalize={hasPermission(ctx, 'finance.entriesFinalize')}
        voucherTypeKey="voucher-own"
        vouchers={[]}
        openItems={openItems}
      />
    </>
  );
}
