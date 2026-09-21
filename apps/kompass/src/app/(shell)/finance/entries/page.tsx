import { hasPermission, listUserNamesWithPermission } from '@kompass/core';
import { displayName, getContact } from '@kompass/module-contacts';
import { getBalances, getIncomeStatement, listAccounts, listCategories, listEntries, listFiscalYears } from '@kompass/module-finance';
import { ForbiddenCard } from '@/components/forbidden-card';
import { BlockedState } from '@/components/blocked-state';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/request-context';
import { readSort } from '@/lib/sort';
import { Journal, type JournalRow } from './journal';
import { SidePanel } from './side-panel';

export interface EntriesQuery {
  year?: string;
  state?: string;
  account?: string;
  category?: string;
  from?: string;
  to?: string;
  q?: string;
  novoucher?: string;
  agent?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

const SORTABLE = ['entryDate', 'number', 'text', 'amount'] as const;
const PAGE_SIZE = 50;

/** Amount displayed for a row: the net of its money lines; without one (Sachspende) the positive allocation total. */
function entryAmountCents(entry: { moneyLines: { amountCents: number }[]; allocationLines: { amountCents: number }[] }): number {
  if (entry.moneyLines.length > 0) return entry.moneyLines.reduce((sum, l) => sum + l.amountCents, 0);
  return entry.allocationLines.filter((l) => l.amountCents > 0).reduce((sum, l) => sum + l.amountCents, 0);
}

export default async function FinanceEntriesPage({ searchParams }: { searchParams: Promise<EntriesQuery> }) {
  const query = await searchParams;
  const { deps, ctx } = await requireSession();
  const t = await getTranslations('finance.journal');

  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;

  const [fiscalYearsRes, accountsRes, categoriesRes] = await Promise.all([
    listFiscalYears(deps, ctx),
    listAccounts(deps, ctx, {}),
    listCategories(deps, ctx, {}),
  ]);
  const fiscalYears = fiscalYearsRes.ok ? fiscalYearsRes.value : [];
  const accounts = accountsRes.ok ? accountsRes.value : [];
  const categories = categoriesRes.ok ? categoriesRes.value : [];

  const defaultYear = fiscalYears.find((y) => y.status === 'open') ?? null;
  const activeAccounts = accounts.filter((a) => a.isActive);

  if (!defaultYear || activeAccounts.length === 0) {
    const names = listUserNamesWithPermission(deps, 'finance.setup');
    return (
      <BlockedState step={t('title')} title={t('notSetUp.title')}>
        {names.length > 0 ? t('notSetUp.textWithNames', { names: names.join(', ') }) : t('notSetUp.text')}
      </BlockedState>
    );
  }

  // Das Geschäftsjahr ist die Vorgabe für die Randspalte (vorläufige Summen) —
  // nicht für den Filter selbst: Ein Entwurf trägt noch kein `fiscalYearId`
  // (das bekommt er erst beim Festschreiben), ein stiller Filter darauf würde
  // jeden Entwurf aus dem Journal verschwinden lassen. Gefiltert wird nach dem
  // Jahr nur, wenn der Betrachter es ausdrücklich wählt.
  const fiscalYearId = query.year || defaultYear.id;
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

  const page = Math.max(1, Number(query.page) || 1);
  const entriesRes = await listEntries(deps, ctx, {
    fiscalYearId: query.year || undefined,
    state: (['draft', 'reviewed', 'final', 'reversed'] as const).includes(query.state as never) ? query.state : undefined,
    accountId: query.account || undefined,
    categoryId: query.category || undefined,
    text: query.q || undefined,
    withoutVoucher: query.novoucher === '1' ? true : undefined,
    agentPrepared: query.agent === '1' ? true : undefined,
    orderBy: readSort(query, SORTABLE) ?? { field: 'entryDate', direction: 'desc' },
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  if (!entriesRes.ok) return <ForbiddenCard permission="finance.read" />;

  const numbersById = new Map(entriesRes.value.entries.map((e) => [e.id, e.number]));

  const contactIds = new Set<string>();
  for (const entry of entriesRes.value.entries) for (const line of entry.allocationLines) if (line.contactId) contactIds.add(line.contactId);
  const contactNames = new Map<string, string>();
  await Promise.all(
    [...contactIds].map(async (id) => {
      const res = await getContact(deps, ctx, id);
      if (res.ok) contactNames.set(id, displayName(res.value));
    }),
  );

  const rows: JournalRow[] = entriesRes.value.entries.map((entry) => {
    const distinctAccounts = new Set(entry.moneyLines.map((l) => l.accountId));
    const accountLabel = distinctAccounts.size === 0 ? '—' : distinctAccounts.size === 1 ? (accountNames.get([...distinctAccounts][0]!) ?? '') : t('accountsCount', { count: distinctAccounts.size });
    const allocationLabel = entry.allocationLines.length === 0 ? '—' : entry.allocationLines.length === 1 ? (categoryNames.get(entry.allocationLines[0]!.categoryId) ?? '') : t('allocationsCount', { count: entry.allocationLines.length });
    const contacts = [...new Set(entry.allocationLines.map((l) => l.contactId).filter((id): id is string => !!id))];
    const contactLabel = contacts.length === 0 ? null : contacts.length === 1 ? (contactNames.get(contacts[0]!) ?? null) : t('contactsCount', { count: contacts.length });

    return {
      id: entry.id,
      number: entry.number,
      entryDate: entry.entryDate,
      text: entry.text,
      accountLabel,
      allocationLabel,
      contactLabel,
      amountCents: entryAmountCents(entry),
      documentationState: entry.documentation.state,
      status: entry.status,
      reviewedAt: entry.reviewedAt,
      reversedByEntryId: entry.reversedByEntryId,
      reversedByNumber: entry.reversedByEntryId ? (numbersById.get(entry.reversedByEntryId) ?? null) : null,
      reversesEntryId: entry.reversesEntryId,
      reversesNumber: entry.reversesEntryId ? (numbersById.get(entry.reversesEntryId) ?? null) : null,
      createdChannel: entry.createdChannel,
    };
  });

  const balancesRes = await getBalances(deps, ctx, {});
  const incomeRes = await getIncomeStatement(deps, ctx, { fiscalYearId });

  const canWrite = hasPermission(ctx, 'finance.entriesWrite');
  const canFinalize = hasPermission(ctx, 'finance.entriesFinalize');
  // Zweiter Knopf im leeren Journal (Task 3): nur solange ein Konto ohne Anfangsbestand existiert und `finance.setup` gilt.
  const showSetupLink = hasPermission(ctx, 'finance.setup') && accounts.some((a) => a.openingBalanceCents === null);

  return (
    <div className="flex gap-5">
      <div className="min-w-0 flex-1">
        <Journal
          rows={rows}
          total={entriesRes.value.total}
          totals={entriesRes.value.totals}
          page={page}
          pageSize={PAGE_SIZE}
          standing={balancesRes.ok ? balancesRes.value.standing : { finalizedThrough: null, draftCount: 0, reviewedDraftCount: 0 }}
          accounts={activeAccounts.map((a) => ({ id: a.id, name: a.name }))}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          canWrite={canWrite}
          canFinalize={canFinalize}
          showSetupLink={showSetupLink}
        />
      </div>
      {balancesRes.ok ? (
        <SidePanel balances={balancesRes.value} incomeStatement={incomeRes.ok ? incomeRes.value : null} />
      ) : null}
    </div>
  );
}
