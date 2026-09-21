import { hasPermission, readSetting } from '@kompass/core';
import { getAccountStatements, getBalances, listAccounts } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AccountCard } from '@/components/finance/account-card';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';

export default async function FinanceAccountsPage() {
  const { deps, ctx } = await requireSession();
  const t = await getTranslations('finance.accounts');
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;

  const [accountsRes, balancesRes, statementsRes] = await Promise.all([listAccounts(deps, ctx, { includeInactive: true }), getBalances(deps, ctx, {}), getAccountStatements(deps, ctx, {})]);
  if (!accountsRes.ok) return <ForbiddenCard permission="finance.read" />;
  const balanceById = new Map((balancesRes.ok ? balancesRes.value.accounts : []).map((a) => [a.accountId, a]));
  const statementById = new Map((statementsRes.ok ? statementsRes.value.accounts : []).map((a) => [a.accountId, a]));
  const warnDays = readSetting<number>(deps, 'finance.lastStatementWarnDays');

  const toCardData = (a: (typeof accountsRes.value)[number]) => {
    const balance = balanceById.get(a.id);
    const statement = statementById.get(a.id);
    return {
      accountId: a.id,
      name: a.name,
      kind: a.kind,
      iban: a.iban,
      balanceCents: balance?.balanceCents ?? 0,
      withReviewedCents: balance?.withReviewedCents ?? 0,
      lastCount: balance?.lastCount ?? null,
      statement:
        statement === undefined
          ? null
          : {
              importedThrough: statement.importedThrough,
              lastStatementDaysAgo: statement.lastStatementDaysAgo,
              warnDays,
              reconciliation: statement.reconciliation,
            },
    };
  };

  const active = accountsRes.value.filter((a) => a.isActive);
  const inactive = accountsRes.value.filter((a) => !a.isActive);
  const canSetup = hasPermission(ctx, 'finance.setup');

  if (accountsRes.value.length === 0) {
    return (
      <EmptyState
        title={t('empty.title')}
        text={t('empty.text')}
        action={canSetup ? <Link href="/admin/finance?panel=accounts" className={buttonVariants()}>{t('empty.action')}</Link> : undefined}
      />
    );
  }

  return (
    <div className="max-w-[900px] space-y-5">
      <PageHeader title={t('title')} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {active.map((a) => (
          <AccountCard key={a.id} account={toCardData(a)} />
        ))}
      </div>
      {inactive.length > 0 ? (
        <Disclosure label={t('inactive')} count={inactive.length}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {inactive.map((a) => (
              <AccountCard key={a.id} account={toCardData(a)} />
            ))}
          </div>
        </Disclosure>
      ) : null}
    </div>
  );
}
