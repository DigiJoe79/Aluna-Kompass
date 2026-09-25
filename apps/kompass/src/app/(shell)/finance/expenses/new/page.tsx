import { hasPermission } from '@kompass/core';
import { DOCUMENT_MAX_BYTES } from '@kompass/module-dms';
import { expenseFormStart, getExpenseClaim } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { BlockedState } from '@/components/blocked-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { deviceFromUserAgent, emptyExpenseForm, emptyPosition, formFromClaim } from '@/lib/finance/expenses';
import { requireSession } from '@/lib/request-context';
import { ExpenseForm } from './expense-form';
import { SubmittedView } from './submitted';

/**
 * D1 „Auslage einreichen“ (F8a Task 5, Designer-README 3a), 390 px zuerst.
 * Nur `finance.expensesSubmit` — kein Lesekonto, kein Journal. `?id=` holt
 * einen eigenen Entwurf zurück (am Telefon begonnen, am Rechner fertig); ist
 * er schon eingereicht, steht an seiner Stelle die Bestätigung.
 */
export default async function NewExpensePage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.expensesSubmit')) return <ForbiddenCard permission="finance.expensesSubmit" />;
  const t = await getTranslations('finance.expenses.new');
  const query = await searchParams;
  const header = <PageHeader title={t('title')} description={t('intro')} back={{ href: '/finance/expenses', label: t('back') }} />;

  const start = await expenseFormStart(deps, ctx, {});
  if (!start.ok) {
    return (
      <div className="max-w-[640px]">
        {header}
        <BlockedState step={t('blocked.step')} title={t('blocked.title')}>
          {start.error.type === 'conflict' ? start.error.message : t('blocked.title')}
        </BlockedState>
      </div>
    );
  }

  const claim = query.id ? await getExpenseClaim(deps, ctx, { id: query.id }) : null;
  if (claim && !claim.ok) {
    return (
      <div className="max-w-[640px]">
        {header}
        <BlockedState step={t('blocked.step')} title={t('title')}>
          {claim.error.type === 'conflict' ? claim.error.message : t('blocked.title')}
        </BlockedState>
      </div>
    );
  }
  if (claim?.ok && claim.value.state === 'submitted') return <SubmittedView claim={claim.value} />;
  if (claim?.ok && claim.value.state !== 'draft') redirect(`/finance/expenses/${claim.value.id}`);

  const today = deps.clock.now().toISOString().slice(0, 10);
  const base = claim?.ok ? formFromClaim(claim.value) : { ...emptyExpenseForm(start.value.iban), positions: [emptyPosition('p0', today)] };
  // Sind Aufwandsspenden inzwischen aus, gibt es keinen Verzicht mehr zu wählen — die IBAN kommt zurück.
  const initial = { ...base, waiver: base.waiver && start.value.waiversEnabled };

  // „Neu einreichen“: der Verweis auf den abgelehnten Antrag, aus dem der Entwurf entstand.
  const source = claim?.ok && claim.value.copiedFromClaimId ? await getExpenseClaim(deps, ctx, { id: claim.value.copiedFromClaimId }) : null;

  return (
    <div className="max-w-[640px]">
      {header}
      {source?.ok ? (
        <p data-testid="expense-copied-from" className="mb-4 rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
          {t('copiedFrom', { number: source.value.number ?? '' })}
        </p>
      ) : null}
      <ExpenseForm
        initial={initial}
        prefilledIban={start.value.iban}
        contactName={start.value.contactName}
        waiversEnabled={start.value.waiversEnabled}
        mileageRates={start.value.mileageRates}
        projects={start.value.projects}
        device={deviceFromUserAgent((await headers()).get('user-agent'))}
        maxBytes={DOCUMENT_MAX_BYTES}
        today={today}
      />
    </div>
  );
}
