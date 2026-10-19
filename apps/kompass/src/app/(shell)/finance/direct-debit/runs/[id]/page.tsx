import { hasPermission, resolveRecordLabel, todayIn, userNamesFor } from '@kompass/core';
import { getDirectDebitRun, listAccounts, listDirectDebitReturns } from '@kompass/module-finance';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { readAllPages } from '@/lib/read-all-pages';
import { requireSession } from '@/lib/request-context';
import { getTranslations } from 'next-intl/server';
import { RunView } from './run-view';

/** Einzug (Handoff 2a § 1.3, 13a–13f): Vorgang, `standard` — Schritte als Prüfliste, Rückgaben, Posten mit Summe. */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  const { id } = await params;
  const t = await getTranslations('finance.directDebit.list');
  const run = await getDirectDebitRun(deps, ctx, { id });
  if (!run.ok) {
    if (run.error.type === 'notFound') notFound();
    return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  }
  const [returns, accounts] = await Promise.all([readAllPages((page) => listDirectDebitReturns(deps, ctx, { runId: id, ...page }), (v) => v.items), listAccounts(deps, ctx, { includeInactive: true })]);
  const names = userNamesFor(deps, [run.value.submittedByUserId, run.value.fileCreatedByUserId]);
  const items = run.value.items
    .filter((i) => i.removedAt === null)
    .map((i) => {
      // Der Zahler öffnet die Zusage bzw. das, woher der Posten kommt (Beitrag → Mitglied), über `recordLabels`.
      const href = i.source === 'pledge' ? `/finance/direct-debit/pledges/${i.sourceId}` : i.origin ? (resolveRecordLabel(deps, ctx, i.origin.type, i.origin.id)?.href ?? null) : null;
      return { id: i.id, debtorName: i.debtorName, remittance: i.remittance, rateOn: i.source === 'pledge' ? i.installmentOn : null, mandateReference: i.mandateReference, amountCents: i.amountCents, returnStatus: i.returnStatus, paidOtherwise: i.paidOtherwise, href };
    });
  const allReturns = returns.ok ? returns.value : [];
  return (
    <RunView
      back={{ href: '/finance/direct-debit', label: t('title') }}
      run={{
        id: run.value.id,
        collectionDate: run.value.collectionDate,
        status: run.value.status,
        count: run.value.count,
        sumCents: run.value.sumCents,
        accountName: (accounts.ok ? accounts.value.find((a) => a.id === run.value.accountId)?.name : undefined) ?? '',
        createdOn: run.value.createdAt,
        fileCreatedAt: run.value.fileCreatedAt,
        submittedOn: run.value.submittedOn,
        submittedBy: run.value.submittedByUserId ? (names.get(run.value.submittedByUserId) ?? null) : null,
        submitFrom: run.value.submitFrom,
        submitBy: run.value.submitBy,
        cancelledAt: run.value.cancelledAt,
      }}
      items={items}
      openReturns={allReturns.filter((r) => r.status === 'open').map((r) => ({ id: r.id, debtorName: r.debtorName, source: r.source, amountCents: r.amountCents, returnCode: r.returnCode, suggestEndMandate: r.suggestEndMandate, feeCents: r.feeCents, itemPaid: r.itemPaid, returnedOn: r.returnedOn }))}
      returnDays={[...new Set(allReturns.map((r) => r.returnedOn))].sort()}
      today={todayIn(deps)}
      canPrepare={hasPermission(ctx, 'finance.directDebit')}
    />
  );
}
