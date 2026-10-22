import { hasPermission, readLocales, requirePermission, todayIn } from '@kompass/core';
import { listFeeSchedules, listMemberOverview, listMemberTypes } from '@kompass/module-members';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { panelHref } from '@/components/panel-nav';
import { buttonVariants } from '@/components/ui/button';
import { nameOrEmpty } from '@/lib/name-or-empty';
import { requireSession } from '@/lib/request-context';
import { hasMemberFilter, memberListInput, PAGE_SIZE, viewOf, type MemberListQuery } from './list-params';
import { MemberList } from './member-list';
import { MembersHeader } from './members-header';

/** Mitgliederliste (Handoff Mitglieder 2.1, 1a–1e): `full`, Reiter, Filterleiste, blättert zu 50. */
export default async function MembersPage({ searchParams }: { searchParams: Promise<MemberListQuery> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'members.read')) return <Page width="full"><ForbiddenCard permission="members.read" /></Page>;
  const t = await getTranslations('members.list');
  const q = await searchParams;
  const view = viewOf(q);
  const input = memberListInput(q);
  const [result, unfiltered, types, schedules] = await Promise.all([
    listMemberOverview(deps, ctx, { ...input, limit: PAGE_SIZE }),
    listMemberOverview(deps, ctx, { view, limit: 1 }),
    listMemberTypes(deps, ctx, { includeInactive: true }),
    listFeeSchedules(deps, ctx, {}),
  ]);
  if (!result.ok || !unfiltered.ok || !types.ok || !schedules.ok) return <Page width="full"><ForbiddenCard permission="members.read" /></Page>;

  const canManage = hasPermission(ctx, 'members.manage');
  const leading = readLocales(deps)[0] ?? 'de';
  const all = unfiltered.value.counts;
  const nothingYet = all.members + all.applications + all.left === 0 && !hasMemberFilter(q);
  // 1d: Ohne Mitgliedsart oder Beitragsordnung fehlen Reiter und Filter; der Weg führt in die Einstellungen.
  const setup = nothingYet && (types.value.every((ty) => !ty.active) || schedules.value.length === 0);
  const exportParams = new URLSearchParams(Object.entries({ view: q.view, text: q.text, type: q.type, pay: q.pay, arrears: q.arrears, rejected: q.rejected }).filter((e): e is [string, string] => !!e[1]));
  const header = (
    <MembersHeader
      canCreate={canManage}
      canCertify={canManage}
      exportHref={`/members/export${exportParams.size ? `?${exportParams.toString()}` : ''}`}
      today={todayIn(deps)}
      setup={setup}
    />
  );

  if (setup) {
    const target = types.value.every((ty) => !ty.active) ? 'types' : 'feeSchedule';
    return (
      <Page width="full" header={header}>
        <EmptyState
          title={t('empty.title')}
          text={t('empty.setup')}
          action={hasPermission(ctx, 'members.fees') ? <Link href={panelHref('/admin/members', target)} className={buttonVariants()}>{t('empty.setupAction')}</Link> : undefined}
        />
      </Page>
    );
  }
  if (nothingYet) {
    return (
      <Page width="full" header={header}>
        <EmptyState title={t('empty.title')} text={t('empty.text')} action={canManage ? <Link href="/members/new" className={buttonVariants()}>{t('create')}</Link> : undefined} />
      </Page>
    );
  }

  return (
    <Page width="full" header={header}>
      <MemberList
        view={view}
        rows={result.value.items}
        counts={result.value.counts}
        total={result.value.total}
        unfiltered={unfiltered.value.total}
        offset={input.offset}
        types={types.value.map((ty) => ({ id: ty.id, name: nameOrEmpty(ty.name[leading], ty.key), active: ty.active }))}
      />
    </Page>
  );
}
