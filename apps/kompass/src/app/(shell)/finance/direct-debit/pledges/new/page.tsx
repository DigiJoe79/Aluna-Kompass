import { hasPermission, todayIn } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { pledgeBindings } from '../../bindings';
import { PledgeForm } from '../pledge-form';

/** Zusage anlegen (Handoff 2a § 1.5): dieselben Felder wie die Zusage, `standard`, `back` „Lastschrift“. */
export default async function NewPledgePage() {
  const { deps, ctx } = await requireSession();
  const t = await getTranslations('finance.directDebit');
  if (!hasPermission(ctx, 'finance.directDebit')) return <Page width="standard"><ForbiddenCard permission="finance.directDebit" /></Page>;
  const bindings = await pledgeBindings(deps, ctx);
  return (
    <Page width="standard" header={<PageHeader title={t('pledge.newTitle')} back={{ href: '/finance/direct-debit?view=pledges', label: t('list.title') }} />}>
      <PledgeForm
        initial={{ contact: null, amountCents: null, interval: 'monthly', firstDueOn: todayIn(deps), lastDueOn: '', binding: '', paymentMethod: 'directDebit', note: null, mandate: null }}
        bindings={bindings}
        canEdit
      />
    </Page>
  );
}
