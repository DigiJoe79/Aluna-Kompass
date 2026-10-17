import { hasPermission } from '@kompass/core';
import { getExpenseClaim } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { FixedValue } from '@/components/fixed-value';
import { ibanLastFour, maskedIban } from '@/lib/finance/iban-check';
import { notFound, redirect } from 'next/navigation';
import { BlockedState } from '@/components/blocked-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Notice } from '@/components/notice';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { dateFormatOf } from '@/lib/date-format';
import { formatEuro } from '@/lib/finance/amount';
import { claimHistory } from '@/lib/finance/expenses';
import { requireSession } from '@/lib/request-context';
import { CopyClaimButton } from '../claim-detail';
import { ClaimState } from '../claims-list';
import { conflictText } from '@/lib/error-text';
import { Section } from '@/components/section';

/**
 * D2 „Antrag geöffnet“ (F8a Task 6, Designer-README 3g): Betrag groß, Zustand
 * mit Satz, Positionen mit Beleg zum Öffnen, Verlauf, wer freigeben kann; bei
 * abgelehnt der Grund und „Neu einreichen“. Ein Entwurf gehört ins Formular.
 */
export default async function ExpenseClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.expensesSubmit') && !hasPermission(ctx, 'finance.read')) return <Page width="task"><ForbiddenCard permission="finance.expensesSubmit" /></Page>;
  const t = await getTranslations('finance.expenses.detail');
  const tCommon = await getTranslations('finance.common');
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
        : t.rich('hint.approved', { iban: () => maskedIban(claim.ibanMasked ?? '', tCommon('ibanEndsWith', { last: ibanLastFour(claim.ibanMasked ?? '') })) })
      : t(`hint.${claim.stateLabelKey}`);

  return (
    <Page width="task" header={<PageHeader back={back} title={t('title', { number: claim.number ?? '' })} />}>
      <div data-testid="claim-detail" className="space-y-5">
        <section className="space-y-2 rounded-lg border border-line bg-surface p-5">
          <p className="text-meta text-muted-ink">{t('amount')}</p>
          <p data-testid="claim-amount" className="text-figure font-semibold tabular-nums">
            {formatEuro(claim.totalCents)}
          </p>
          {/* 08 A3 · 08 A4: Marke und ein Satz — der Hinweis unten ist der Satz; das Datum steht im Verlauf. */}
          <ClaimState claim={claim} fmt={fmt} sentence={false} />
          {/* Nach dem Einreichen steht der Verzicht fest: Satz statt Schalter (E2, 08 B19). */}
          {/* Nur ein Verzicht ist eine Auskunft; „Nein“ ist der Normalfall und steht nicht da (Runde 3, 102). */}
          {claim.submittedAt && claim.waiver ? (
            <FixedValue
              id="claim-waiver"
              testId="claim-waiver"
              size="full"
              label={t('waiverLabel')}
              value={t('waiverYes')}
              reason={t('waiverFixed', { date: fmt.date(claim.submittedAt) })}
            />
          ) : null}
          <p className="text-body text-ink-2">{hint}</p>
          {/* 08 B11: Wer freigeben kann, steht in der Statuskarte, nicht frei unter dem Verlauf. */}
          {claim.stateLabelKey === 'submitted' ? (
            <p data-testid="approver-names" className="text-body text-ink-2">
              {claim.approverNames.length > 0 ? t('approvers', { names: claim.approverNames.join(' · ') }) : t('noApprover')}
            </p>
          ) : null}
          {source?.ok ? <p className="text-hint text-muted-ink">{t('copiedFrom', { number: source.value.number ?? '' })}</p> : null}
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
          <Section title={t('positions')} headingId="claim-positions">
            <div className="flex flex-col gap-3">
              <ul className="divide-y divide-line">
                {claim.positions.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5 text-body">
                    <span className="min-w-0 text-ink">
                      {p.kind === 'trip' ? t('trip', { from: p.tripFrom ?? '', to: p.tripTo ?? '', km: p.tripKm ?? 0 }) : p.purpose}
                      {/* „Beleg öffnen“ als Textlink in der Unterzeile, der Betrag steht allein rechts (Runde 3, 102). */}
                      <span className="block text-hint text-muted-ink">
                        {fmt.date(p.positionDate)}
                        {p.documentId ? (
                          <>
                            {' · '}
                            <a href={`/finance/expenses/${claim.id}/receipt/${p.documentId}`} target="_blank" rel="noreferrer" className="text-link underline underline-offset-2">
                              {t('openReceipt')}
                            </a>
                          </>
                        ) : null}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">{formatEuro(p.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        </section>

        <section aria-labelledby="claim-history-title" className="rounded-lg border border-line bg-surface p-5">
          <Section title={t('history')} headingId="claim-history-title">
            <div className="flex flex-col gap-3">
              <ol data-testid="claim-history" className="space-y-1.5 text-body">
                {claimHistory(claim).map((event) => (
                  <li key={event.key} className="flex justify-between gap-3">
                    <span className="text-ink">{t(`event.${event.key}`)}</span>
                    <span className="text-meta tabular-nums text-ink-2">{event.at.length > 10 ? fmt.dateTime(event.at) : fmt.date(event.at)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Section>
        </section>

        {/* 08 A5: Kein zweiter Zurück-Knopf unten — der Seitenkopf hat „← Eigene Auslagen“. */}
      </div>
    </Page>
  );
}
