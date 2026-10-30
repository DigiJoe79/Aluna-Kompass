import { requirePermission, todayIn } from '@kompass/core';
import { listOrgans, RESOLUTION_KINDS } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { detailsOptionsFor } from '@/lib/governance/details-options';
import { requireSession } from '@/lib/request-context';
import { CircularForm } from '../circular-form';

/** Umlauf anlegen; vorbelegt der Vorstand. */
export default async function NewCircularPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.manage')) return <Page width="standard"><ForbiddenCard permission="governance.manage" /></Page>;
  const t = await getTranslations('governance');
  const organs = await listOrgans(deps, ctx, {});
  if (!organs.ok) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const board = organs.value.find((o) => o.kind === 'board') ?? organs.value[0]!;
  // Wahl und Entlastung brauchen den Mitlauf (Wahlgänge, Betroffene); im Umlauf die übrigen Arten.
  const kinds = RESOLUTION_KINDS.filter((k) => k !== 'election' && k !== 'discharge' && k !== 'agenda' && k !== 'minutesApproval');
  return (
    <Page width="standard" header={<PageHeader back={{ href: '/governance/circulars', label: t('circulars.title') }} title={t('circulars.create')} />}>
      <CircularForm organs={organs.value.map((o) => ({ id: o.id, name: o.name }))} defaultOrganId={board.id} kinds={[...kinds]} today={todayIn(deps)} options={await detailsOptionsFor(deps, ctx, { on: todayIn(deps) })} />
    </Page>
  );
}
