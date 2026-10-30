import { hasPermission, requirePermission } from '@kompass/core';
import { listMeetings, listOrgans, MEETING_KINDS } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { dateFormatOf } from '@/lib/date-format';
import { meetingTitle } from '@/lib/governance/meeting-state';
import { requireSession } from '@/lib/request-context';
import { MeetingCreateForm } from './meeting-create-form';

/** Sitzung anlegen (Plan U1 Task 4): `standard`, eine Karte, `?organ=` belegt das Organ vor. */
export default async function NewMeetingPage({ searchParams }: { searchParams: Promise<{ organ?: string; kind?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'governance.manage')) return <Page width="standard"><ForbiddenCard permission="governance.manage" /></Page>;
  const t = await getTranslations('governance');
  const { organ, kind } = await searchParams;
  const [organs, meetings] = await Promise.all([listOrgans(deps, ctx, {}), listMeetings(deps, ctx, {})]);
  if (!organs.ok || !meetings.ok) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const fmt = dateFormatOf(deps);
  const name = new Map(organs.value.map((o) => [o.id, o.name]));
  return (
    <Page width="standard" header={<PageHeader title={t('head.createTitle')} back={{ href: '/governance/meetings', label: t('meetings.listTitle') }} />}>
      <MeetingCreateForm
        organs={organs.value.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name, kind: o.kind }))}
        presetOrganId={organ}
        presetKind={(MEETING_KINDS as readonly string[]).includes(kind ?? '') ? kind : undefined}
        repeatCandidates={meetings.value.filter((m) => m.state === 'recorded' || m.state === 'signed').map((m) => ({ id: m.id, organId: m.organId, label: meetingTitle((k, v) => t(k, v), fmt.date, m, name.get(m.organId) ?? '') }))}
        canPickContacts={hasPermission(ctx, 'contacts.view')}
      />
    </Page>
  );
}
