import { hasPermission, readSetting, requirePermission, todayIn } from '@kompass/core';
import { listGovernanceDeadlines, listMeetings, listOrgans, MEETING_STATES, type MeetingState } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { dateFormatOf } from '@/lib/date-format';
import { meetingBadge, meetingTitle } from '@/lib/governance/meeting-state';
import { requireSession } from '@/lib/request-context';
import { MeetingList, type MeetingListRow } from './meeting-list';

type Query = { organ?: string; year?: string; state?: string };

/** Sitzungen (Plan U1 Task 4, Spec § 12 Nr. 4): Filter Organ, Jahr, Zustand in der Adresse. */
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.read')) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const t = await getTranslations('governance');
  const q = await searchParams;
  const year = q.year && /^\d{4}$/.test(q.year) ? Number(q.year) : undefined;
  const state = (MEETING_STATES as readonly string[]).includes(q.state ?? '') ? (q.state as MeetingState) : undefined;
  const [all, filtered, organs, deadlines] = await Promise.all([
    listMeetings(deps, ctx, {}),
    listMeetings(deps, ctx, { ...(q.organ ? { organId: q.organ } : {}), ...(year ? { year } : {}), ...(state ? { states: [state] } : {}) }),
    listOrgans(deps, ctx, { includeInactive: true }),
    listGovernanceDeadlines(deps, ctx, {}),
  ]);
  if (!all.ok || !filtered.ok || !organs.ok) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;

  const canCreate = hasPermission(ctx, 'governance.manage');
  const header = <PageHeader title={t('meetings.listTitle')} actions={canCreate ? <Link href="/governance/meetings/new" className={buttonVariants()}>{t('meetings.create')}</Link> : undefined} />;
  if (all.value.length === 0) {
    return (
      <Page width="standard" header={header}>
        <EmptyState title={t('meetings.empty.title')} text={t('meetings.empty.text')} action={canCreate ? <Link href="/governance/meetings/new" className={buttonVariants()}>{t('meetings.create')}</Link> : undefined} />
      </Page>
    );
  }

  const fmt = dateFormatOf(deps);
  const today = todayIn(deps);
  const lead = readSetting<number>(deps, 'governance.deadlineLeadDays');
  const inviteBy = new Map((deadlines.ok ? deadlines.value : []).filter((d) => d.kind === 'inviteBy').map((d) => [d.key.slice('inviteBy:'.length), d.dueOn]));
  const organName = new Map(organs.value.map((o) => [o.id, o.name]));
  // Neueste zuerst; der Dienst liefert aufsteigend.
  const rows: MeetingListRow[] = [...filtered.value].reverse().map((m) => {
    const badge = meetingBadge({ state: m.state, heldOn: m.heldOn, inviteBy: inviteBy.get(m.id) ?? null }, today, lead);
    return {
      id: m.id,
      heldOn: m.heldOn,
      title: meetingTitle((key, values) => t(key, values), fmt.date, m, organName.get(m.organId) ?? ''),
      sub: [t(`meetings.forms.${m.form}`), m.place].filter(Boolean).join(' · '),
      organ: organName.get(m.organId) ?? '',
      badge: badge ? { status: badge.status, label: t(`states.meeting.${badge.status}`, { date: badge.date ? fmt.date(badge.date) : '' }) } : null,
    };
  });
  const years = [...new Set(all.value.map((m) => m.heldOn.slice(0, 4)))].sort().reverse();

  return (
    <Page width="standard" header={header}>
      <MeetingList
        rows={rows}
        total={all.value.length}
        organs={organs.value.map((o) => ({ id: o.id, name: o.name }))}
        years={years}
        states={MEETING_STATES.map((s) => ({ value: s, label: t(`states.meeting.${s}`, { date: '' }) }))}
      />
    </Page>
  );
}
