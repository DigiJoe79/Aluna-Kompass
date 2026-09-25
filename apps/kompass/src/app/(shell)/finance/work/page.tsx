import { hasPermission, listUserNamesWithPermission, readSetting, type LocalizedText } from '@kompass/core';
import { displayName, getContact } from '@kompass/module-contacts';
import { documentTypeFor } from '@kompass/module-dms';
import { getWorkCounts, listAccounts, listCategories, listForeignMoney, listPurposes, listWorkItems, readInvoiceFromDocument, suggestForTransaction, TAX_CODES, type SuggestionReason, type SuggestionView } from '@kompass/module-finance';
import { listProjects } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { formatDate, type DateFormatMode } from '@/lib/dates';
import { formatEuro } from '@/lib/finance/amount';
import { formatDateOrDash } from '@/lib/finance/dates';
import { parseWorkTab, WORK_TABS, workHref } from '@/lib/finance/work';
import { requireSession } from '@/lib/request-context';
import { cn } from '@/lib/utils';
import { ImportUpload } from '../imports/upload';
import { AccountFilter } from './account-filter';
import { BatchFinalizeDialog } from './batch-finalize-dialog';
import type { WorkDetailData } from './work-detail';
import { WorkEntries, WorkOpenItems, WorkTransactions, type WorkEntryRow, type WorkOpenItemRow, type WorkTransactionRow } from './work-list';

export interface WorkQuery {
  tab?: string;
  account?: string;
  raw?: string;
  /** Aus der Karte „Aus der Rechnung“ (F5b): dieses Dokument kommt nach dem Übernehmen als Beleg an den Entwurf. */
  voucher?: string;
}

/**
 * Die Arbeitsliste (F5 Task 7, HANDOFF § 12.5 B1): oben die Ablagefläche und
 * die Reiter mit Zählern, links die Liste, rechts der gewählte Kontoumsatz
 * mit seinem Vorschlag. Reiter, Konto und Auswahl stehen in der Adresse.
 * `finance.read` genügt zum Lesen; Übernehmen, Verknüpfen und die
 * Tastenkürzel brauchen `finance.entriesWrite`.
 */
export default async function FinanceWorkPage({ searchParams }: { searchParams: Promise<WorkQuery> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;
  const t = await getTranslations('finance.work');
  const canWrite = hasPermission(ctx, 'finance.entriesWrite');
  const dateMode = readSetting<DateFormatMode>(deps, 'ui.dateFormat');
  const fmtDate = (value: string | null | undefined) => formatDate(value, dateMode);

  const query = await searchParams;
  const tab = parseWorkTab(query.tab);
  const accountsRes = await listAccounts(deps, ctx, { includeInactive: true });
  if (!accountsRes.ok) return <ForbiddenCard permission="finance.read" />;
  const accounts = accountsRes.value;
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const account = query.account && accountName.has(query.account) ? query.account : null;

  const [countsRes, itemsRes] = await Promise.all([getWorkCounts(deps, ctx), listWorkItems(deps, ctx, { tab, accountId: account ?? undefined, limit: 200, offset: 0 })]);
  if (!countsRes.ok || !itemsRes.ok) return <ForbiddenCard permission="finance.read" />;
  const counts = countsRes.value;
  const items = itemsRes.value.items;

  const importable = accounts.filter((a) => a.isActive && (a.kind === 'bank' || a.kind === 'paymentService')).map((a) => ({ id: a.id, name: a.name }));
  const filterAccounts = accounts.filter((a) => a.isActive).map((a) => ({ id: a.id, name: a.name }));

  const contactNames = new Map<string, string>();
  const loadContacts = async (ids: Iterable<string>) => {
    await Promise.all(
      [...new Set(ids)].filter((id) => !contactNames.has(id)).map(async (id) => {
        const res = await getContact(deps, ctx, id);
        if (res.ok) contactNames.set(id, displayName(res.value));
      }),
    );
  };

  let body: React.ReactNode;
  if (tab === 'open' || tab === 'unsure') {
    const rows: WorkTransactionRow[] = items.flatMap((item) =>
      item.type === 'transaction'
        ? [{
            id: item.transaction.id,
            bookingDate: item.transaction.bookingDate,
            counterpartyName: item.transaction.counterpartyName,
            purpose: item.transaction.purpose,
            amountCents: item.transaction.amountCents,
            accountName: accountName.get(item.transaction.accountId) ?? '',
            state: item.transaction.state === 'open' ? 'open' : item.transaction.entryStatus === 'draft' ? 'proposed' : 'booked',
            origin: item.suggestion.reasons[0]?.kind ?? null,
            unsure: item.suggestion.confidence === 'unsure',
          } satisfies WorkTransactionRow]
        : [],
    );
    const selectedId = query.raw && rows.some((r) => r.id === query.raw) ? query.raw : (rows[0]?.id ?? null);
    const selectedItem = items.find((i) => i.type === 'transaction' && i.transaction.id === selectedId);
    let detail: WorkDetailData | null = null;
    if (selectedItem && selectedItem.type === 'transaction') {
      const suggestionRes = await suggestForTransaction(deps, ctx, { rawTransactionId: selectedItem.transaction.id });
      const suggestion = suggestionRes.ok ? suggestionRes.value : null;
      await loadContacts([
        ...(suggestion?.reasons.map((r) => r.contactId).filter((id): id is string => !!id) ?? []),
        ...(suggestion?.draft?.allocationLines.map((l) => l.contactId).filter((id): id is string => !!id) ?? []),
      ]);
      const raw = selectedItem.transaction;
      // „Rückzahlung von“ gibt es nur bei einem Ausgang — die Eingänge fremden Gelds, die noch nicht weitergegeben sind.
      const foreignRes = raw.amountCents < 0 && canWrite ? await listForeignMoney(deps, ctx) : null;
      // `?voucher=` gilt nur für den Umsatz, den die Karte gewählt hat; ein Wechsel der Auswahl lässt ihn fallen.
      const invoiceRes = query.voucher && canWrite && raw.id === query.raw ? await readInvoiceFromDocument(deps, ctx, { documentId: query.voucher }) : null;
      const invoice = invoiceRes?.ok ? invoiceRes.value : null;
      detail = {
        raw: { ...raw, accountName: accountName.get(raw.accountId) ?? '' },
        suggestion: suggestion ? await describeSuggestion(suggestion, accountName, contactNames, fmtDate) : null,
        contactNames: Object.fromEntries(contactNames),
        pendingInvoice: invoice && query.voucher ? { documentId: query.voucher, number: invoice.invoiceNumber, seller: invoice.sellerName } : null,
        foreignReturnOptions: (foreignRes?.ok ? foreignRes.value.items : []).map((item) => ({
          lineId: item.lineId,
          label: t('foreign.returnsOption', { date: fmtDate(item.entryDate), holder: item.holderText, amount: formatEuro(item.amountCents) }),
        })),
      };
    }

    const [categoriesRes, purposesRes, projectsRes] = await Promise.all([listCategories(deps, ctx, { includeInactive: true }), listPurposes(deps, ctx, {}), listProjects(deps, ctx)]);
    const leading = deps.locales()[0] ?? 'de';
    const allCategories = categoriesRes.ok ? categoriesRes.value : [];
    const purposeOptions = (purposesRes.ok ? purposesRes.value : []).map((p) => ({ id: p.id, name: p.name }));
    const projectOptions = (projectsRes.ok ? projectsRes.value : []).map((p) => ({ id: p.id, name: (p.name as LocalizedText)[leading] || p.slug }));
    const showTax = readSetting<boolean>(deps, 'finance.isEntrepreneurOrHasVatId');
    body = (
      <WorkTransactions
        key={`${tab}-${account ?? ''}`}
        rows={rows}
        selectedId={selectedId}
        tab={tab}
        account={account}
        canWrite={canWrite}
        waitingCount={counts.open + counts.unsure}
        detail={detail}
        form={{
          categories: allCategories
            .filter((c): c is typeof c & { direction: 'income' | 'expense' } => c.isActive && (c.direction === 'income' || c.direction === 'expense'))
            .map((c) => ({ id: c.id, name: c.name, direction: c.direction, sphere: c.sphere ?? 'ideal', explanation: c.explanation || undefined })),
          categoryNames: Object.fromEntries(allCategories.map((c) => [c.id, c.name])),
          purposes: purposeOptions,
          projects: projectOptions,
          taxCodeOptions: [...TAX_CODES],
          showTax,
          rule: {
            accounts: filterAccounts,
            categories: allCategories.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name })),
            projects: projectOptions,
            purposes: purposeOptions,
            taxCodeOptions: [...TAX_CODES],
            showTax,
          },
          voucherTypes: readSetting<string[]>(deps, 'finance.voucherTypes').map((key) => ({ key, label: documentTypeFor(deps.db, key)?.label ?? key })),
          canCreateContact: hasPermission(ctx, 'contacts.manage'),
          contactGrantNames: hasPermission(ctx, 'contacts.manage') ? [] : listUserNamesWithPermission(deps, 'users.manage'),
        }}
      />
    );
  } else if (tab === 'agent' || tab === 'reviewed') {
    const rows: WorkEntryRow[] = items.flatMap((item) =>
      item.type === 'entry'
        ? [{
            id: item.entry.id,
            number: item.entry.number,
            entryDate: item.entry.entryDate,
            text: item.entry.text,
            totalCents: item.entry.totalCents,
            reviewedAt: item.entry.reviewedAt,
            createdChannel: item.entry.createdChannel,
            accountNames: [...new Set(item.entry.moneyLines.map((l) => accountName.get(l.accountId) ?? ''))].join(', '),
          }]
        : [],
    );
    body = <WorkEntries rows={rows} tab={tab} canWrite={canWrite} />;
  } else {
    const openItems = items.flatMap((i) => (i.type === 'openItem' ? [i.openItem] : []));
    await loadContacts(openItems.map((i) => i.contactId).filter((id): id is string => !!id));
    const rows: WorkOpenItemRow[] = openItems.map((i) => ({
      id: i.id,
      kind: i.kind,
      dueOn: i.dueOn,
      openCents: i.openCents,
      paymentReference: i.paymentReference,
      contactName: i.contactId ? (contactNames.get(i.contactId) ?? null) : null,
    }));
    body = <WorkOpenItems rows={rows} />;
  }

  const countOf = { open: counts.open, unsure: counts.unsure, agent: counts.agent, reviewed: counts.reviewed, due: counts.due } as const;
  const tone = { open: 'bg-info-bg text-info', unsure: 'bg-warning-bg text-warning', agent: 'bg-agent-bg text-agent', reviewed: 'bg-info-bg text-info', due: 'bg-error-bg text-error' } as const;

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('description')} />

      <div className="sticky top-0 z-10 space-y-3 bg-bg pb-2">
        {canWrite && importable.length > 0 ? <ImportUpload accounts={importable} defaultAccountId={account && importable.some((a) => a.id === account) ? account : undefined} /> : null}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div role="tablist" aria-label={t('tabsGroup')} className="flex flex-wrap gap-1 border-b border-line">
            {WORK_TABS.map((key) => (
              <Link
                key={key}
                href={workHref({ tab: key, account })}
                role="tab"
                aria-selected={tab === key}
                className={cn('-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-[13px]', tab === key ? 'border-primary font-semibold text-ink' : 'border-transparent text-ink-2')}
              >
                {t(`tabs.${key}`)}
                <span data-testid={`work-count-${key}`} className={cn('rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums', countOf[key] > 0 ? tone[key] : 'bg-surface-2 text-muted-ink')}>
                  {countOf[key]}
                </span>
              </Link>
            ))}
          </div>
          <AccountFilter accounts={filterAccounts} value={account} tab={tab} />
        </div>

        {counts.heldCandidates > 0 ? (
          <p className="text-[13px] text-ink-2">
            {t('held', { count: counts.heldCandidates })}{' '}
            <Link href="/finance/imports" className="font-semibold underline underline-offset-2">
              {t('heldLink')}
            </Link>
          </p>
        ) : null}
        {counts.reviewed > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
            <span className="text-ink-2">{t('reviewedLine', { count: counts.reviewed })}</span>
            {hasPermission(ctx, 'finance.entriesFinalize') ? <BatchFinalizeDialog reviewedCount={counts.reviewed} /> : null}
          </div>
        ) : null}
      </div>

      {body}
    </div>
  );
}

/** Die Gründe als Sätze und die weiteren Geldzeilen als Text — die Namen löst der Server auf, der Client zeigt nur. */
async function describeSuggestion(
  suggestion: SuggestionView,
  accountName: ReadonlyMap<string, string>,
  contactNames: ReadonlyMap<string, string>,
  fmtDate: (value: string | null | undefined) => string,
): Promise<NonNullable<WorkDetailData['suggestion']>> {
  const t = await getTranslations('finance.work');
  const contact = (id?: string) => (id ? (contactNames.get(id) ?? t('reasons.hiddenContact')) : t('reasons.hiddenContact'));
  const account = (id?: string) => (id ? (accountName.get(id) ?? '') : '');
  const linkDate = formatDateOrDash(fmtDate, suggestion.linkEntry?.entryDate);
  const reasonText = (r: SuggestionReason): string => {
    switch (r.kind) {
      case 'linkEntry':
        return r.entryNumber ? t('reasons.linkEntry', { number: r.entryNumber, date: linkDate }) : t('reasons.linkDraft', { date: linkDate });
      case 'pair':
        return t('reasons.pair', { account: account(r.otherAccountId) });
      case 'cashKeyword':
        return t('reasons.cashKeyword', { account: account(r.otherAccountId) });
      case 'returnCode':
        return t('reasons.returnCode', { number: r.entryNumber ?? t('reasons.noNumber') });
      case 'paymentReference':
        return t('reasons.paymentReference', { reference: r.paymentReference ?? '' });
      case 'amountAndContact':
        return t('reasons.amountAndContact', { contact: contact(r.contactId) });
      case 'rule':
        return t('reasons.rule', { name: r.ruleName ?? '' });
      case 'contactIban':
        return t('reasons.contactIban', { contact: contact(r.contactId) });
    }
  };
  const extraLines = (suggestion.draft?.moneyLines.slice(1) ?? []).map((line) =>
    t(suggestion.kind === 'cashTransfer' ? 'mini.cashLine' : 'mini.transferLine', { account: account(line.accountId), amount: formatEuro(line.amountCents) }),
  );
  const settled = suggestion.draft?.moneyLines[0]?.settlements?.reduce((sum, s) => sum + s.amountCents, 0) ?? 0;
  if (settled > 0) extraLines.push(t('mini.settles', { amount: formatEuro(settled) }));
  return {
    kind: suggestion.kind,
    confidence: suggestion.confidence,
    reasonTexts: suggestion.reasons.map(reasonText),
    draft: suggestion.draft,
    linkEntry: suggestion.linkEntry,
    problems: suggestion.problems,
    hints: suggestion.hints,
    extraLineTexts: extraLines,
  };
}
