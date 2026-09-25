import { hasPermission, listUserNamesWithPermission, readSetting } from '@kompass/core';
import { getBalances, listCashCounts, listEntries } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BlockedState } from '@/components/blocked-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { formatDate, type DateFormatMode } from '@/lib/dates';
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
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;

  const dateMode = readSetting<DateFormatMode>(deps, 'ui.dateFormat');
  const query = await searchParams;
  const balancesRes = await getBalances(deps, ctx, {});
  if (!balancesRes.ok) return <ForbiddenCard permission="finance.overview" />;

  const cashAccounts = balancesRes.value.accounts.filter((a) => a.kind === 'cash');
  const bankAccounts = balancesRes.value.accounts.filter((a) => a.kind === 'bank');

  if (cashAccounts.length === 0) {
    return (
      <BlockedState step={t('title')} title={t('noAccount.title')}>
        {t('noAccount.text')}
      </BlockedState>
    );
  }

  const selected = (query.account && cashAccounts.find((a) => a.accountId === query.account)) || cashAccounts[0]!;
  const today = deps.clock.now().toISOString().slice(0, 10);

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
    <div className="max-w-[720px] space-y-5">
      <PageHeader title={t('title')} />

      {cashAccounts.length > 1 ? (
        <div className="flex gap-2">
          {cashAccounts.map((a) => (
            <Link
              key={a.accountId}
              href={`/finance/cash?account=${a.accountId}`}
              className={a.accountId === selected.accountId ? 'rounded-sm bg-selected px-2.5 py-1 text-[13px] font-semibold text-selected-ink' : 'rounded-sm bg-surface-2 px-2.5 py-1 text-[13px] text-ink-2'}
            >
              {a.name}
            </Link>
          ))}
        </div>
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
                    {formatDate(entry.entryDate, dateMode)} · {entry.text}
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
                <span>{formatDate(count.countedOn, dateMode)}</span>
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
  );
}
