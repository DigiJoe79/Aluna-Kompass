import { hasPermission } from '@kompass/core';
import { getExpenseClaim } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { BlockedState } from '@/components/blocked-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Notice } from '@/components/notice';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { dateFormatOf } from '@/lib/date-format';
import { formatEuro } from '@/lib/finance/amount';
import { claimHistory } from '@/lib/finance/expenses';
import { requireSession } from '@/lib/request-context';
import { CopyClaimButton } from '../claim-detail';
import { ClaimState } from '../claims-list';
import { conflictText } from '@/lib/error-text';

/**
 * D2 „Antrag geöffnet“ (F8a Task 6, Designer-README 3g): Betrag groß, Zustand
 * mit Satz, Positionen mit Beleg zum Öffnen, Verlauf, wer freigeben kann; bei
 * abgelehnt der Grund und „Neu einreichen“. Ein Entwurf gehört ins Formular.
 */
export default async function ExpenseClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.expensesSubmit') && !hasPermission(ctx, 'finance.read')) return <Page width="task"><ForbiddenCard permission="finance.expensesSubmit" /></Page>;
  const t = await getTranslations('finance.expenses.detail');
  const fmt = dateFormatOf(deps);
  const { id } = await params;
  const back = { href: '/finance/expenses', label: t('back') };

  const result = await getExpenseClaim(deps, ctx, { id });
  if (!result.ok) {
    if (result.error.type === 'notFound') notFound();
    return (
      <Page width="task" header={<PageHeader back={back} title={t('title', { number: '' })} />}>
        <BlockedState step={t('back')} title={t('title', { number: '' })}>
          {result.error.type === 'conflict' ? conflictText(result.error, await getTranslations()) : ''}
        </BlockedState>
      </Page>
    );
  }
  const claim = result.value;
  if (claim.state === 'draft') redirect(`/finance/expenses/new?id=${claim.id}`);
  const source = claim.copiedFromClaimId ? await getExpenseClaim(deps, ctx, { id: claim.copiedFromClaimId }) : null;
  const hint =
    claim.stateLabelKey === 'approved'
      ? claim.waiver
        ? t('hint.approvedWaiver')
        : t('hint.approved', { iban: claim.ibanMasked ?? '' })
      : t(`hint.${claim.stateLabelKey}`);

  return (
    <Page width="task" header={<PageHeader back={back} title={t('title', { number: claim.number ?? '' })} />}>
      <div data-testid="claim-detail" className="space-y-5">
        <section className="space-y-2 rounded-lg border border-line bg-surface p-5">
          <p className="text-[13px] text-muted-ink">{t('amount')}</p>
          <p data-testid="claim-amount" className="font-mono text-[34px] font-semibold tabular-nums">
            {formatEuro(claim.totalCents)}
          </p>
          <ClaimState claim={claim} fmt={fmt} />
          {claim.waiver ? <p className="text-[14px] text-ink-2">{t('waiver')}</p> : null}
          <p className="text-[14px] text-ink-2">{hint}</p>
          {source?.ok ? <p className="text-[12px] text-muted-ink">{t('copiedFrom', { number: source.value.number ?? '' })}</p> : null}
        </section>

        {claim.stateLabelKey === 'rejected' ? (
          <div data-testid="claim-reason" className="space-y-3">
            <Notice level="hint" title={t('reason')}>
              {claim.rejectNote}
            </Notice>
            <CopyClaimButton claimId={claim.id} />
          </div>
        ) : null}

        <section aria-labelledby="claim-positions" className="rounded-lg border border-line bg-surface p-5">
          <h3 id="claim-positions" className="mb-2 text-[13px] font-semibold text-muted-ink">
            {t('positions')}
          </h3>
          <ul className="divide-y divide-line">
            {claim.positions.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5 text-[14px]">
                <span className="min-w-0 text-ink">
                  {p.kind === 'trip' ? t('trip', { from: p.tripFrom ?? '', to: p.tripTo ?? '', km: p.tripKm ?? 0 }) : p.purpose}
                  <span className="block text-[12px] text-muted-ink">{fmt.date(p.positionDate)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {p.documentId ? (
                    <a href={`/finance/expenses/${claim.id}/receipt/${p.documentId}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                      {t('openReceipt')}
                    </a>
                  ) : null}
                  <span className="font-mono tabular-nums">{formatEuro(p.amountCents)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="claim-history-title" className="rounded-lg border border-line bg-surface p-5">
          <h3 id="claim-history-title" className="mb-2 text-[13px] font-semibold text-muted-ink">
            {t('history')}
          </h3>
          <ol data-testid="claim-history" className="space-y-1.5 text-[14px]">
            {claimHistory(claim).map((event) => (
              <li key={event.key} className="flex justify-between gap-3">
                <span className="text-ink">{t(`event.${event.key}`)}</span>
                <span className="font-mono text-[13px] tabular-nums text-ink-2">{event.at.length > 10 ? fmt.dateTime(event.at) : fmt.date(event.at)}</span>
              </li>
            ))}
          </ol>
        </section>

        {claim.stateLabelKey === 'submitted' ? (
          <p data-testid="approver-names" className="text-[14px] text-ink-2">
            {claim.approverNames.length > 0 ? t('approvers', { names: claim.approverNames.join(' · ') }) : t('noApprover')}
          </p>
        ) : null}

        <Link href="/finance/expenses" className={buttonVariants({ variant: 'outline', className: 'w-full sm:w-auto' })}>
          {t('back')}
        </Link>
      </div>
    </Page>
  );
}
