import { hasPermission, requirePermission, todayIn } from '@kompass/core';
import { getStatuteContext } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { dateFormatOf } from '@/lib/date-format';
import { meetingTitle } from '@/lib/governance/meeting-state';
import { requireSession } from '@/lib/request-context';
import { StatuteHeader } from './statute-actions';
import { StatuteView } from './statute-view';

/** Ein Satzungsstand als Lesesicht (Board 5b). */
export default async function StatutePage(props: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.read')) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const { id } = await props.params;
  const t = await getTranslations('governance');
  const res = await getStatuteContext(deps, ctx, { statuteId: id });
  if (!res.ok) notFound();
  const c = res.value;
  const s = c.statute;
  const fmt = dateFormatOf(deps);
  const title = s.lastResolvedOn ? t('statutes.version', { date: fmt.date(s.lastResolvedOn) }) : t('statutes.draft');
  const first = c.resolutions.find((r) => r.meetingId && r.meetingKind);
  const assembly = c.organs.find((o) => o.kind === 'assembly')?.name ?? '';
  const parts = [
    s.note,
    first?.meetingKind ? t('statute.resolvedIn', { meeting: meetingTitle((k, v) => t(k, v), fmt.date, { kind: first.meetingKind, heldOn: first.on }, assembly) }) : s.lastResolvedOn ? t('statute.resolvedOn', { date: fmt.date(s.lastResolvedOn) }) : null,
    s.registeredOn ? t('statute.registeredOnText', { date: fmt.date(s.registeredOn) }) : null,
  ].filter(Boolean);
  const description = `${parts.join(', ')}${parts.length ? '.' : ''}${s.state === 'valid' ? ` ${t('statute.validSince')}` : ''}`.trim();
  return (
    <Page
      width="standard"
      header={
        <StatuteHeader
          id={s.id}
          state={s.state}
          title={title}
          description={description || undefined}
          stateLabel={t(`states.statute.${s.state}`)}
          manage={hasPermission(ctx, 'governance.manage')}
          today={todayIn(deps)}
          back={{ href: '/governance/statutes', label: t('statutes.title') }}
        />
      }
    >
      <StatuteView context={c} date={fmt.date} manage={hasPermission(ctx, 'governance.manage')} />
    </Page>
  );
}
