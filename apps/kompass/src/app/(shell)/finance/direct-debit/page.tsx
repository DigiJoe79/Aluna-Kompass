import { hasPermission, todayIn } from '@kompass/core';
import { getSepaSetupState, listAccounts, listDirectDebitRuns, listMandates, listPledges } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { panelHref } from '@/components/panel-nav';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { bindingOf, pledgeBindings } from './bindings';
import { DirectDebitList, type MandateRow } from './direct-debit-list';
import { mandatesInput, offsetOf, PAGE_SIZE, pledgesInput, runsInput, viewOf, type DirectDebitQuery } from './list-params';

/** Lastschrift (Handoff 2a § 1.1, 11a–11e): `full`, Reiter Einzüge · Mandate · Zusagen, ohne Gläubiger-ID die Einrichtung. */
export default async function DirectDebitPage({ searchParams }: { searchParams: Promise<DirectDebitQuery> }) {
  const { deps, ctx } = await requireSession();
  const t = await getTranslations('finance.directDebit.list');
  const setup = await getSepaSetupState(deps, ctx);
  if (!setup.ok) return <Page width="full"><ForbiddenCard permission="finance.read" /></Page>;
  const canPrepare = hasPermission(ctx, 'finance.directDebit');

  // 11e: Ohne Gläubiger-ID (oder ausgeschaltet) fehlen Reiter und Filter; der Weg führt in die Einstellungen.
  if (!setup.value.enabled || setup.value.missing.includes('creditorId')) {
    return (
      <Page width="full" header={<PageHeader title={t('title')} />}>
        <EmptyState
          title={t('setup.title')}
          text={t('setup.text')}
          action={hasPermission(ctx, 'finance.setup') ? <Link href={panelHref('/admin/finance', 'directDebit')} className={buttonVariants()}>{t('setup.action')}</Link> : undefined}
        />
      </Page>
    );
  }

  const q = await searchParams;
  const view = viewOf(q);
  const defaultYear = Number(todayIn(deps).slice(0, 4));
  const year = Number(q.year) || defaultYear;
  const [runs, runsAll, mandates, mandatesAll, pledges, pledgesAll, accounts, bindings] = await Promise.all([
    listDirectDebitRuns(deps, ctx, view === 'runs' ? { ...runsInput(q, year), limit: PAGE_SIZE } : { year: defaultYear, limit: 1 }),
    listDirectDebitRuns(deps, ctx, { year: view === 'runs' ? year : defaultYear, limit: 1 }),
    listMandates(deps, ctx, view === 'mandates' ? { ...mandatesInput(q), limit: PAGE_SIZE } : { limit: 1 }),
    listMandates(deps, ctx, { limit: 1 }),
    listPledges(deps, ctx, view === 'pledges' ? { ...pledgesInput(q), limit: PAGE_SIZE } : { limit: 1 }),
    listPledges(deps, ctx, { limit: 1 }),
    listAccounts(deps, ctx, { includeInactive: true }),
    pledgeBindings(deps, ctx, { includeInactive: true }),
  ]);
  if (!runs.ok || !runsAll.ok || !mandates.ok || !mandatesAll.ok || !pledges.ok || !pledgesAll.ok) return <Page width="full"><ForbiddenCard permission="finance.read" /></Page>;

  const accountName = (id: string) => (accounts.ok ? accounts.value.find((a) => a.id === id)?.name : undefined) ?? '';
  const bindingName = (key: string | null) => (key ? (bindings.find((b) => b.value === key)?.label ?? null) : null);
  const current = view === 'runs' ? runs.value : view === 'mandates' ? mandates.value : pledges.value;
  const unfiltered = view === 'runs' ? runsAll.value.total : view === 'mandates' ? mandatesAll.value.total : pledgesAll.value.total;
  const years = [...new Set([defaultYear, year, ...runsAll.value.years])].sort((a, b) => b - a);

  const header = (
    <PageHeader
      title={t('title')}
      more={[{ key: 'pledge', label: t('newPledge'), href: '/finance/direct-debit/pledges/new', hidden: !canPrepare, testId: 'direct-debit-new-pledge' }]}
      actions={canPrepare ? <Link href="/finance/direct-debit/runs/new" className={buttonVariants()} data-testid="direct-debit-new-run">{t('newRun')}</Link> : null}
    />
  );

  return (
    <Page width="full" header={header}>
      <DirectDebitList
        view={view}
        // Je Reiter, was ein Klick zeigt: Einzüge im laufenden (bzw. gewählten) Jahr, Mandate und Zusagen ohne Filter.
        counts={{ runs: runsAll.value.total, mandates: mandatesAll.value.total, pledges: pledgesAll.value.total }}
        total={current.total}
        unfiltered={unfiltered}
        offset={offsetOf(q)}
        year={year}
        defaultYear={defaultYear}
        years={years}
        runs={view === 'runs' ? runs.value.items.map((r) => ({ id: r.id, collectionDate: r.collectionDate, count: r.count, submittedOn: r.submittedOn, accountName: accountName(r.accountId), sumCents: r.sumCents, status: r.status, openReturns: r.openReturns })) : []}
        mandates={
          view === 'mandates'
            ? mandates.value.items.map((m) => ({
                id: m.id,
                payer: m.contactName ?? m.debtorName,
                reference: m.reference,
                iban: m.iban,
                signedOn: m.signedOn,
                usedFor: m.usedFor.map((u): MandateRow['usedFor'][number] => (u.kind === 'pledge' ? 'pledge' : u.label?.key.endsWith('.application') ? 'application' : 'membership')),
                state: m.state,
              }))
            : []
        }
        pledges={
          view === 'pledges'
            ? pledges.value.items.map((p) => ({ id: p.id, name: p.contactName ?? '', interval: p.interval, bound: bindingName(bindingOf(p)), nextDueOn: p.nextDueOn, paymentMethod: p.paymentMethod, amountCents: p.amountCents, state: p.state }))
            : []
        }
        bindings={bindings}
      />
    </Page>
  );
}
