import { hasPermission, todayIn } from '@kompass/core';
import { getPledge, listDirectDebitReturns, type PledgeRate } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { dateFormatOf } from '@/lib/date-format';
import { formatEuro } from '@/lib/finance/amount';
import { readAllPages } from '@/lib/read-all-pages';
import { requireSession } from '@/lib/request-context';
import { bindingOf, pledgeBindings } from '../../bindings';
import { PledgeForm } from '../pledge-form';
import { PledgeActions } from './pledge-actions';
import { RatesList } from './rates-list';

/**
 * Zusage (Handoff 2a § 1.5, Nachtrag Phase 2 § 1): Stammdaten wie das Mitglied, zweispaltig ab `xl` — das Formular,
 * daneben die Raten (berechnet; keine offenen Zahlungen). Ältere Jahre eingeklappt.
 */
export default async function PledgePage({ params }: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  const { id } = await params;
  const t = await getTranslations('finance.directDebit');
  const pledge = await getPledge(deps, ctx, { id });
  if (!pledge.ok) {
    if (pledge.error.type === 'notFound') notFound();
    return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  }
  const p = pledge.value;
  const today = todayIn(deps);
  const year = Number(today.slice(0, 4));
  // Die nächste erwartete Rate, falls sie im neuen Jahr liegt, und die früheren Jahre (Nachtrag § 1).
  const [next, earlier, bindings, returns] = await Promise.all([
    p.nextDueOn && p.nextDueOn > `${year}-12-31` ? getPledge(deps, ctx, { id, from: p.nextDueOn, to: p.nextDueOn }) : null,
    p.firstDueOn < `${year}-01-01` ? getPledge(deps, ctx, { id, from: p.firstDueOn, to: `${year - 1}-12-31` }) : null,
    pledgeBindings(deps, ctx, { includeInactive: true }),
    p.mandate ? readAllPages((page) => listDirectDebitReturns(deps, ctx, { mandateId: p.mandate!.id, status: 'open', ...page }), (v) => v.items) : null,
  ]);
  const openReturns = (returns?.ok ? returns.value : []).filter((r) => r.source === 'pledge' && r.sourceId === p.id).map((r) => ({ id: r.id, debtorName: r.debtorName, source: r.source, amountCents: r.amountCents, returnCode: r.returnCode, suggestEndMandate: r.suggestEndMandate, feeCents: r.feeCents }));
  const current: PledgeRate[] = [...(next?.ok ? next.value.rates : []), ...p.rates].sort((a, b) => b.dueOn.localeCompare(a.dueOn));
  const older = (earlier?.ok ? earlier.value.rates : []).sort((a, b) => b.dueOn.localeCompare(a.dueOn));
  const bookedThisYear = p.rates.filter((r) => r.state === 'booked').reduce((sum, r) => sum + r.amountCents, 0);
  const fmt = dateFormatOf(deps);
  const canPrepare = hasPermission(ctx, 'finance.directDebit');
  const name = p.contactName ?? '';

  return (
    <Page
      width="standard"
      header={
        <PageHeader
          title={name}
          description={t('pledge.since', { date: fmt.date(p.firstDueOn) })}
          back={{ href: '/finance/direct-debit?view=pledges', label: t('list.title') }}
          status={p.state === 'active' ? undefined : <StatusBadge tone={statusTone('pledge', p.state)} dot>{t(`states.pledge.${p.state}`)}</StatusBadge>}
          actions={canPrepare && p.state !== 'ended' ? <PledgeActions pledgeId={p.id} today={today} /> : null}
        />
      }
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:items-start">
        <PledgeForm
          initial={{
            id: p.id,
            contact: { id: p.contactId, name },
            amountCents: p.amountCents,
            interval: p.interval,
            firstDueOn: p.firstDueOn,
            lastDueOn: p.lastDueOn ?? '',
            binding: bindingOf(p) ?? '',
            paymentMethod: p.paymentMethod,
            note: p.note,
            mandate: p.mandate,
          }}
          bindings={bindings}
          canEdit={canPrepare && p.state !== 'ended'}
        />
        <RatesList
          intro={t('pledge.ratesIntro', { amount: formatEuro(p.amountCents), interval: t(`pledge.intervals.${p.interval}`), year, booked: formatEuro(bookedThisYear) })}
          current={current}
          older={older}
          openReturns={openReturns}
          canResolve={canPrepare}
        />
      </div>
    </Page>
  );
}
