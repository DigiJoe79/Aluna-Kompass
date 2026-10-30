import { hasPermission, requirePermission } from '@kompass/core';
import { getStatuteContext } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { dateFormatOf } from '@/lib/date-format';
import { requireSession } from '@/lib/request-context';
import { StatuteForm } from './statute-form';

/** Stand bearbeiten (Plan U2 Task 10). */
export default async function StatuteEditPage(props: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.manage')) return <Page width="standard"><ForbiddenCard permission="governance.manage" /></Page>;
  const { id } = await props.params;
  const t = await getTranslations('governance');
  const res = await getStatuteContext(deps, ctx, { statuteId: id });
  if (!res.ok) notFound();
  const fmt = dateFormatOf(deps);
  const s = res.value.statute;
  const version = s.lastResolvedOn ? t('statutes.version', { date: fmt.date(s.lastResolvedOn) }) : t('statutes.draft');
  const linked = res.value.resolutions.find((r) => r.resolutionId !== null);
  return (
    <Page width="standard" header={<PageHeader back={{ href: `/governance/statutes/${s.id}`, label: version }} title={t('statute.editTitle')} />}>
      <StatuteForm context={res.value} canPickDocuments={hasPermission(ctx, 'dms.view')} labelOf={{ resolution: linked ? [linked.number, fmt.date(linked.on)].filter(Boolean).join(' · ') : null }} />
    </Page>
  );
}
