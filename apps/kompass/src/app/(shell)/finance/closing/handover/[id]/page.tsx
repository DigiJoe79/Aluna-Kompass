import { hasPermission } from '@kompass/core';
import { getHandover, listFiscalYears } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { requireSession } from '@/lib/request-context';
import { HandoverView } from '../handover-view';

/**
 * Amtsübergabe (Board 13e, 14c): eine `task`-Seite mit drei Schritten — Zwischenbericht, Kassenzählung, Protokoll — und
 * „Daran denken“. Lesen mit `finance.read`, handeln mit `finance.setup`. Der Rückweg führt zum Jahresabschluss des
 * Jahres (die Seite hängt nicht in der Navigation).
 */
export default async function HandoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <Page width="task"><ForbiddenCard permission="finance.read" /></Page>;
  const res = await getHandover(deps, ctx, { id });
  if (!res.ok) notFound();
  const handover = res.value;
  const t = await getTranslations('finance.closing.handover');
  const years = await listFiscalYears(deps, ctx);
  const year = years.ok ? years.value.find((y) => y.id === handover.fiscalYearId) : undefined;

  return (
    <Page width="task">
      <HandoverView
        handover={handover}
        year={{ id: handover.fiscalYearId, designation: year?.designation ?? '', startsOn: year?.startsOn ?? handover.handoverOn }}
        back={{ href: `/finance/closing?year=${encodeURIComponent(handover.fiscalYearId)}`, label: t('back', { year: year?.designation ?? '' }) }}
        canManage={hasPermission(ctx, 'finance.setup')}
        canCount={hasPermission(ctx, 'finance.setup') && hasPermission(ctx, 'finance.entriesFinalize')}
        canCreateContact={hasPermission(ctx, 'contacts.manage')}
      />
    </Page>
  );
}
