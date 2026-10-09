import { hasPermission, listUserNamesWithPermission, todayIn } from '@kompass/core';
import { getBalances, listCashCounts, listEntries } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BlockedState } from '@/components/blocked-state';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { ViewTabs } from '@/components/view-tabs';
import { panelHref } from '@/components/panel-nav';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { dateFormatOf } from '@/lib/date-format';
import { formatEuro } from '@/lib/finance/amount';
import { CountDialog } from './count-dialog';
import { MoveDialog } from './move-dialog';
import { PaidDialog } from './paid-dialog';

export interface CashPageQuery {
  account?: string;
}

export default async function FinanceCashPage({ searchParams }: { searchParams: Promise<CashPageQuery> }) {
  const { deps, ctx } = await requireSession();
  const t = await getTranslations('finance.cash');
  if (!hasPermission(ctx, 'finance.read')) return <Page width="task"><ForbiddenCard permission="finance.read" /></Page>;

  const fmt = dateFormatOf(deps);
  const query = await searchParams;
  const balancesRes = await getBalances(deps, ctx, {});
  if (!balancesRes.ok) return <Page width="task"><ForbiddenCard permission="finance.overview" /></Page>;

  const cashAccounts = balancesRes.value.accounts.filter((a) => a.kind === 'cash');
  const bankAccounts = balancesRes.value.accounts.filter((a) => a.kind === 'bank');

  if (cashAccounts.length === 0) {
    // Noch nichts eingerichtet ist kein gesperrter Schritt, sondern ein leerer Zustand mit Ausweg (K9-Befund 6).
    const canSetup = hasPermission(ctx, 'finance.setup');
    const setupNames = canSetup ? [] : listUserNamesWithPermission(deps, 'finance.setup');
    return (
      <Page width="task" header={<PageHeader title={t('title')} />}>
        <EmptyState
          title={t('noAccount.title')}
          text={canSetup ? t('noAccount.text') : setupNames.length > 0 ? t('noAccount.textNoRightWithNames', { names: setupNames.join(', ') }) : t('noAccount.textNoRight')}
          action={canSetup ? <Link href={panelHref('/admin/finance', 'accounts')} className={buttonVariants()}>{t('noAccount.action')}</Link> : undefined}
        />
      </Page>
    );
  }

  const selected = (query.account && cashAccounts.find((a) => a.accountId === query.account)) || cashAccounts[0]!;
  const today = todayIn(deps);

  const [countsRes, entriesRes] = await Promise.all([
    listCashCounts(deps, ctx, { accountId: selected.accountId, limit: 20 }),
    listEntries(deps, ctx, { accountId: selected.accountId, limit: 10, orderBy: { field: 'entryDate', direction: 'desc' } }),
  ]);

  const canFinalize = hasPermission(ctx, 'finance.entriesFinalize');
  const names = canFinalize ? [] : listUserNamesWithPermission(deps, 'finance.entriesFinalize');
  // Zählende wählt man aus den Kontakten — ohne contacts.view bleibt das Feld leer (Spec 5.4).
  const canPickContacts = hasPermission(ctx, 'contacts.view');
  const canCreateContact = hasPermission(ctx, 'contacts.manage');
  const grantNames = listUserNamesWithPermission(deps, 'users.manage');

  return (
    <Page width="task" header={<PageHeader title={t('title')} />}>
      <div className="space-y-5">

        {cashAccounts.length > 1 ? (
          <ViewTabs
            label={t('accountsGroup')}
            current={selected.accountId}
            tabs={cashAccounts.map((a) => ({ key: a.accountId, label: a.name, href: `/finance/cash?account=${a.accountId}` }))}
          />
        ) : null}

        <div data-testid="cash-balance" className="rounded-lg border border-line bg-surface p-5">
          <p className="text-[13px] text-muted-ink">{selected.name}</p>
          <p className="font-mono text-[34px] font-semibold tabular-nums">{formatEuro(selected.balanceCents)}</p>
        </div>

        {canFinalize ? (
          <div className="flex flex-wrap items-start gap-2.5">
            {canPickContacts ? (
              // `key`: ein Kontowechsel montiert den Dialog neu, statt einen veralteten Buchbestand mitzuschleppen.
              <CountDialog
                key={`count-${selected.accountId}`}
                account={{ id: selected.accountId, name: selected.name, bookCents: selected.balanceCents }}
                today={today}
                canCreateContact={canCreateContact}
              />
            ) : (
              <BlockedState step={t('count.trigger')} title={t('noContactsView.title')}>
                {grantNames.length > 0 ? t('noContactsView.textWithNames', { names: grantNames.join(', ') }) : t('noContactsView.text')}
              </BlockedState>
            )}
            {bankAccounts.length > 0 ? <MoveDialog key={`move-${selected.accountId}`} cashId={selected.accountId} bankAccounts={bankAccounts.map((a) => ({ id: a.accountId, name: a.name }))} today={today} /> : null}
            <PaidDialog cashId={selected.accountId} />
          </div>
        ) : (
          <BlockedState step={t('title')} title={t('noRight.title')}>
            {names.length > 0 ? t('noRight.textWithNames', { names: names.join(', ') }) : t('noRight.text')}
          </BlockedState>
        )}

        <section aria-label={t('lastMovements.title')} className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-heading text-[15px]">{t('lastMovements.title')}</h3>
            <Link href={`/finance/entries?account=${selected.accountId}`} className="text-[13px] text-link">
              {t('lastMovements.toJournal')}
            </Link>
          </div>
          {entriesRes.ok && entriesRes.value.entries.length > 0 ? (
            <ul className="divide-y divide-line rounded-md border border-line">
              {entriesRes.value.entries.map((entry) => {
                const amount = entry.moneyLines.filter((l) => l.accountId === selected.accountId).reduce((s, l) => s + l.amountCents, 0);
                return (
                  <li key={entry.id} className="flex items-center justify-between px-3 py-2 text-[13px]">
                    <span>
                      {fmt.date(entry.entryDate)} · {entry.text}
                    </span>
                    <span className="font-mono tabular-nums">{formatEuro(amount)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-ink">{t('lastMovements.empty')}</p>
          )}
        </section>

        <section aria-label={t('counts.title')} className="space-y-2">
          <h3 className="font-heading text-[15px]">{t('counts.title')}</h3>
          {countsRes.ok && countsRes.value.counts.length > 0 ? (
            <ul className="divide-y divide-line rounded-md border border-line">
              {countsRes.value.counts.map((count) => (
                <li key={count.id} className="flex items-center justify-between px-3 py-2 text-[13px]">
                  <span>{fmt.date(count.countedOn)}</span>
                  <a href={`/finance/cash/${count.id}/protocol`} target="_blank" rel="noreferrer" className="text-link">
                    {count.documentNumber}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-ink">{t('counts.empty')}</p>
          )}
        </section>
      </div>
    </Page>
  );
}
