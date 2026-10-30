import { hasPermission, readSetting } from '@kompass/core';
import { getMeeting, getMeetingContext, INVITATION_RUN_KINDS, previewInvitationRun, type InvitationRunKind } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { dateFormatOf } from '@/lib/date-format';
import { meetingTitle } from '@/lib/governance/meeting-state';
import { toActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';
import { InvitationStart } from './invitation-start';

/**
 * Einladungslauf (Plan U1 Task 6, wie der Mahnlauf): Vorschau · Ausstellen · Versand. Keine Auswahl — Empfänger sind
 * alle Mitglieder am Ausstellungstag (Spec § 5.3). Nach dem Ausstellen geht es zurück zu Schritt 2 der Sitzung.
 */
export default async function InvitationRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { id } = await params;
  const { kind: rawKind } = await searchParams;
  const kind: InvitationRunKind = (INVITATION_RUN_KINDS as readonly string[]).includes(rawKind ?? '') ? (rawKind as InvitationRunKind) : 'invitation';
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'governance.read')) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const [detail, context] = await Promise.all([getMeeting(deps, ctx, { id }), getMeetingContext(deps, ctx, { meetingId: id })]);
  if (!detail.ok || !context.ok) notFound();
  const t = await getTranslations('governance');
  const fmt = dateFormatOf(deps);
  const title = meetingTitle((key, values) => t(key, values), fmt.date, detail.value, context.value.organ.name);
  const back = { href: `/governance/meetings/${id}`, label: title };
  const preview = await previewInvitationRun(deps, ctx, { meetingId: id, kind });
  const header = <PageHeader title={t(`invite.run.titles.${kind}`)} description={title} back={back} />;
  if (!preview.ok) {
    return (
      <Page width="standard" header={header}>
        <RefusalNotice state={toActionState(preview, await getTranslations())} />
      </Page>
    );
  }
  return (
    <Page width="standard" header={header}>
      <InvitationStart meetingId={id} kind={kind} preview={preview.value} names={context.value.names} canStart={hasPermission(ctx, 'governance.manage')} agentsAllowed={readSetting<boolean>(deps, 'governance.mcpHumanOnlyAllowed') === true} />
    </Page>
  );
}
