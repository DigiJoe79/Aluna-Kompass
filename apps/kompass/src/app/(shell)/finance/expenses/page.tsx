import { hasPermission, readSetting } from '@kompass/core';
import { listMyExpenseClaims } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BlockedState } from '@/components/blocked-state';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import type { DateFormatMode } from '@/lib/dates';
import { groupClaims } from '@/lib/finance/expenses';
import { requireSession } from '@/lib/request-context';
import { ClaimGroup } from './claims-list';

/**
 * D2 „Eigene Anträge“ (F8a Task 6, Designer-README 3g), 390 px zuerst: die
 * eigenen Anträge als Karten, Gruppen Offen und Erledigt. Nur
 * `finance.expensesSubmit` — wer einreichen darf, sieht seine eigenen immer.
 */
export default async function ExpensesPage() {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.expensesSubmit')) return <ForbiddenCard permission="finance.expensesSubmit" />;
  const t = await getTranslations('finance.expenses.list');
  const mode = readSetting<DateFormatMode>(deps, 'ui.dateFormat');
  const newLink = (
    <Link href="/finance/expenses/new" className={buttonVariants({ variant: 'default' })}>
      {t('new')}
    </Link>
  );

  const result = await listMyExpenseClaims(deps, ctx, { limit: 200 });
  if (!result.ok) {
    return (
      <div className="max-w-[640px]">
        <PageHeader title={t('title')} description={t('intro')} />
        <BlockedState step={t('blocked.step')} title={t('blocked.title')}>
          {result.error.type === 'conflict' ? result.error.message : t('blocked.title')}
        </BlockedState>
      </div>
    );
  }

  const groups = groupClaims(result.value.items);
  return (
    <div className="max-w-[640px]">
      <PageHeader title={t('title')} description={t('intro')} actions={result.value.items.length > 0 ? newLink : undefined} />
      {result.value.items.length === 0 ? (
        <div data-testid="claims-empty">
          <EmptyState title={t('emptyTitle')} text={t('emptyText')} action={newLink} />
        </div>
      ) : (
        <div className="space-y-6">
          <ClaimGroup id="open" title={t('open')} claims={groups.open} mode={mode} />
          <ClaimGroup id="done" title={t('done')} claims={groups.done} mode={mode} />
        </div>
      )}
    </div>
  );
}
