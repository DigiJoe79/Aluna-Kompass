import { requirePermission } from '@kompass/core';
import { getStatuteContext } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { dateFormatOf } from '@/lib/date-format';
import { requireSession } from '@/lib/request-context';
import { RulesForm } from './rules-form';

/** Regelwerk bearbeiten (Board 5c). */
export default async function RulesPage(props: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.manage')) return <Page width="standard"><ForbiddenCard permission="governance.manage" /></Page>;
  const { id } = await props.params;
  const t = await getTranslations('governance');
  const res = await getStatuteContext(deps, ctx, { statuteId: id });
  if (!res.ok) notFound();
  const s = res.value.statute;
  const fmt = dateFormatOf(deps);
  const version = s.lastResolvedOn ? t('statutes.version', { date: fmt.date(s.lastResolvedOn) }) : t('statutes.draft');
  const since = s.registeredOn ?? s.lastResolvedOn;
  return (
    <Page width="standard" header={<PageHeader back={{ href: `/governance/statutes/${s.id}`, label: version }} title={t('rulesEdit.title')} description={s.state === 'draft' || !since ? t('rulesEdit.descriptionDraft') : t('rulesEdit.description', { date: fmt.date(since) })} />}>
      <RulesForm statuteId={s.id} rules={s.rules} organs={res.value.organs} locked={s.registeredOn !== null || s.state === 'superseded'} />
    </Page>
  );
}
