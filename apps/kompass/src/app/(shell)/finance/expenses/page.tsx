import { hasPermission } from '@kompass/core';
import { listMyExpenseClaims } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BlockedState } from '@/components/blocked-state';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ListPager } from '@/components/list-pager';
import { ListTruncated } from '@/components/list-truncated';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { dateFormatOf } from '@/lib/date-format';
import { requireSession } from '@/lib/request-context';
import { ClaimGroup } from './claims-list';
import { conflictText } from '@/lib/error-text';

/**
 * D2 „Eigene Anträge“ (F8a Task 6, Designer-README 3g), 390 px zuerst: die
 * eigenen Anträge als Karten, Gruppen Offen und Erledigt. Nur
 * `finance.expensesSubmit` — wer einreichen darf, sieht seine eigenen immer.
 */
/** Erledigte Anträge je Seite (MUSTER § L) — bis 0.2.8 still die jüngsten 200 über beide Gruppen. */
const PAGE_SIZE = 50;
/** Offene Anträge sind Arbeit und stehen ganz da; mehr als diese Zahl nennt `ListTruncated`. */
const OPEN_LIMIT = 200;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.expensesSubmit')) return <Page width="standard"><ForbiddenCard permission="finance.expensesSubmit" /></Page>;
  const t = await getTranslations('finance.expenses.list');
  const fmt = dateFormatOf(deps);
  const newLink = (
    <Link href="/finance/expenses/new" className={buttonVariants({ variant: 'default' })}>
      {t('new')}
    </Link>
  );

  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [openRes, doneRes] = await Promise.all([
    listMyExpenseClaims(deps, ctx, { state: 'open', limit: OPEN_LIMIT }),
    listMyExpenseClaims(deps, ctx, { state: 'done', limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);
  if (!openRes.ok || !doneRes.ok) {
    const failure = !openRes.ok ? openRes : (doneRes as Extract<typeof doneRes, { ok: false }>);
    return (
      <Page width="standard" header={<PageHeader title={t('title')} description={t('intro')} />}>
        <BlockedState step={t('blocked.step')} title={t('blocked.title')}>
          {failure.error.type === 'conflict' ? conflictText(failure.error, await getTranslations()) : t('blocked.title')}
        </BlockedState>
      </Page>
    );
  }

  const open = openRes.value;
  const done = doneRes.value;
  const any = open.total + done.total > 0;
  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('intro')} actions={any ? newLink : undefined} />}>
      {!any ? (
        <div data-testid="claims-empty">
          <EmptyState title={t('emptyTitle')} text={t('emptyText')} action={newLink} />
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <ClaimGroup id="open" title={t('open')} claims={open.items} fmt={fmt} />
            <ListTruncated shown={open.items.length} total={open.total} text={t('openTruncated', { shown: open.items.length, total: open.total })} className="mt-2" testId="claims-open-truncated" />
          </div>
          <div>
            <ClaimGroup id="done" title={t('done')} claims={done.items} fmt={fmt} />
            {/* Karten ohne gemeinsame Karte: Der Pager sitzt direkt darunter (MUSTER § L). */}
            <ListPager
              total={done.total}
              offset={(page - 1) * PAGE_SIZE}
              pageSize={PAGE_SIZE}
              hrefFor={(next) => (next > 0 ? `/finance/expenses?page=${Math.floor(next / PAGE_SIZE) + 1}` : '/finance/expenses')}
              testId="claims-done-pager"
            />
          </div>
        </div>
      )}
    </Page>
  );
}
