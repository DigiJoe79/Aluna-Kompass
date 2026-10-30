'use client';

import type { AgendaItemView, InvitationDispatchState, InvitationRunView, MeetingContext, MeetingDetail, MotionView } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { PageHeader } from '@/components/page-header';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Steps, type Step } from '@/components/steps';
import { Button, buttonVariants } from '@/components/ui/button';
import { dayNumber } from '@/lib/governance/meeting-state';
import { meetingSteps, MEETING_STEP_KEYS, type MeetingStepKey } from '@/lib/governance/meeting-steps';
import { proposeAgendaAction, startMeetingAction } from './actions';
import { AgendaItemDialog, type AgendaItemDraft } from './agenda-item-dialog';
import { AgendaSection } from './agenda-section';
import { MeetingActions } from './meeting-actions';
import { MeetingWarnings } from './meeting-warnings';
import type { MeetingHeadFieldsProps } from '../meeting-head-fields';
import { MotionsCard } from './motions-card';
import { useBoardInvitationStep } from './board-invitation';
import { useMinutesStep } from './minutes-step';
import { useSealStep } from './seal-step';
import { useInviteDeadline, useInviteStep } from './invite-step';

export type StepSlot = Pick<Step, 'detail' | 'action' | 'below'>;

export interface MeetingViewProps {
  meeting: MeetingDetail;
  context: MeetingContext;
  title: string;
  back: { href: string; label: string };
  today: string;
  dispatchDone: boolean | null;
  openPoints: number;
  statutes: { id: string; label: string }[];
  documentLabels: Record<string, string>;
  perms: { manage: boolean; record: boolean; contacts: boolean; dms: boolean };
  head: Omit<MeetingHeadFieldsProps, 'errors'>;
  /** Einladen (Task 6): Läufe und Versand der Mitgliederversammlung, Nummer der Einladung des Vorstands. */
  invitation: { runs: InvitationRunView[]; runRefPrefix: string; dispatch: InvitationDispatchState | null; documentNumber: string | null };
  /** Was die Schritte Protokoll und Festschreiben tragen (Task 11). */
  slots?: Partial<Record<MeetingStepKey, StepSlot>>;
  documents: ReactNode;
}

/**
 * Die Sitzung als Vorgang (Board 2a–2d, wie die Amtsübergabe): Kopf mit Zustand und Satz, fünf Schritte in einer Karte,
 * darunter Tagesordnung, Anträge und Dokumente.
 */
export function MeetingView({ meeting: m, context, title, back, today, dispatchDone, openPoints, statutes, documentLabels, perms, head, invitation, slots = {}, documents }: MeetingViewProps) {
  const t = useTranslations('governance');
  const fmt = useDateFormat();
  const router = useRouter();
  const [draft, setDraft] = useState<AgendaItemDraft | null>(null);
  const start = useActionFeedback();
  const propose = useActionFeedback();
  const [pending, setPending] = useState(false);
  const preparing = m.state === 'planned' || m.state === 'invited';
  const editable = perms.manage && preparing;
  const assembly = context.organ.kind === 'assembly';
  const minutesFiled = context.minutes.length > 0;
  const steps = meetingSteps({ state: m.state, heldOn: m.heldOn, organKind: context.organ.kind, invitedOn: m.invitedOn, dispatchDone, minutesFiled, openPoints }, today);
  const doneCount = Object.values(steps.done).filter(Boolean).length;
  const deadlineText = useInviteDeadline()(m.deadlines);
  const assemblyInvite = useInviteStep({ meetingId: m.id, invitedOn: m.invitedOn, deadline: m.deadlines, runs: invitation.runs, runRefPrefix: invitation.runRefPrefix, dispatch: invitation.dispatch, compliance: context.compliance, canManage: perms.manage, preparing, today });
  const boardInvite = useBoardInvitationStep({ meetingId: m.id, invitedOn: m.invitedOn, documentId: m.invitationDocumentId, documentNumber: invitation.documentNumber, note: m.invitationNote, deadlineText, canManage: perms.manage, preparing, today });
  const inviteSlot = assembly ? assemblyInvite : boardInvite;
  const minutesSlot = useMinutesStep({ meeting: m, context, canManage: perms.manage, canRecord: perms.record, today });
  const sealSlot = useSealStep({ meeting: m, context, canManage: perms.manage });

  const run = async (feedback: ReturnType<typeof useActionFeedback>, action: () => ReturnType<typeof startMeetingAction>) => {
    setPending(true);
    const result = await feedback.run(action);
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  const present = m.attendance.filter((a) => a.periods.length > 0);
  const detail: Record<MeetingStepKey, ReactNode> = {
    prepare: context.statute ? t('meeting.prepareDetail', { count: m.agenda.length, date: fmt.date(context.statute.since) }) : t('meeting.prepareDetailLaw', { count: m.agenda.length }),
    invite: inviteSlot.detail ?? t('meeting.invitePending'),
    meeting:
      m.state === 'recorded' || m.state === 'signed'
        ? t('meeting.meetingDone', { date: fmt.date(m.heldOn), from: m.startsAt, to: m.endedAt ?? '', voting: present.filter((a) => !a.guest && a.votingRight).length, guests: present.filter((a) => a.guest).length, items: m.agenda.length })
        : t('meeting.meetingTodo', { date: fmt.date(m.heldOn), time: m.startsAt }),
    minutes: m.state === 'recorded' ? (minutesSlot.detail ?? null) : t('meeting.minutesPending'),
    seal: m.state === 'recorded' ? (sealSlot.detail ?? null) : t('meeting.sealPending'),
  };
  const action: Partial<Record<MeetingStepKey, ReactNode>> = {};
  const below: Partial<Record<MeetingStepKey, ReactNode>> = {};
  if (steps.active === 'prepare' && editable && m.agenda.length === 0) {
    below.prepare = (
      <div className="flex flex-col gap-2">
        <div>
          <Button type="button" variant="outline" onClick={() => void run(propose, () => proposeAgendaAction(m.id))} disabled={pending} data-testid="agenda-propose">{t('meeting.proposeAgenda')}</Button>
        </div>
        <RefusalNotice action state={propose.state} />
      </div>
    );
  }
  if (m.state === 'running') action.meeting = <Link href={`/governance/meetings/${m.id}/live`} className={buttonVariants({ size: 'sm' })} data-testid="meeting-open-live">{t('meeting.openLive')}</Link>;
  else if (steps.active === 'meeting' && perms.record && preparing) {
    below.meeting = (
      <div className="flex flex-col gap-2">
        <div>
          <Button type="button" onClick={() => void run(start, () => startMeetingAction(m.id))} disabled={pending} data-testid="meeting-start">{t('meeting.start')}</Button>
        </div>
        <RefusalNotice action state={start.state} />
      </div>
    );
  }

  const stepList: Step[] = MEETING_STEP_KEYS.map((key) => ({
    key,
    label: t(`meeting.steps.${key}`),
    state: steps.done[key] ? 'done' : steps.active === key ? 'active' : 'todo',
    detail: slots[key]?.detail ?? detail[key],
    action: slots[key]?.action ?? action[key],
    below: slots[key]?.below ?? (key === 'minutes' && m.state === 'recorded' ? minutesSlot.below : key === 'seal' && m.state === 'recorded' ? sealSlot.below : key === 'invite' && (steps.active === 'invite' || steps.active === 'prepare' || m.state === 'invited') ? inviteSlot.below : below[key]),
  }));

  const kindLabel = t(`meetings.kinds.${m.kind}`);
  const description =
    m.state === 'cancelled'
      ? t('meeting.headCancelled', { date: fmt.date(m.cancelledOn ?? m.heldOn), reason: m.cancelReason ?? '' })
      : t('meeting.head', { kind: kindLabel, form: t(`meetings.forms.${m.form}`), date: fmt.date(m.heldOn), time: m.startsAt, place: m.place ? `, ${m.place}` : '', done: doneCount });

  // Antragsfrist in Tagen zurückgerechnet: `motionsBy` ist der letzte Tag vor `days` vollen Tagen.
  const motionDays = m.deadlines.motionsBy ? dayNumber(m.heldOn) - dayNumber(m.deadlines.motionsBy) - 1 : null;
  return (
    <>
      <PageHeader
        back={back}
        title={title}
        status={<StatusBadge tone={statusTone('meeting', m.state)} dot>{t(`states.meeting.${m.state}`, { date: '' })}</StatusBadge>}
        description={<span data-testid="meeting-head">{description}</span>}
        actions={perms.manage && m.state !== 'cancelled' ? <MeetingActions meetingId={m.id} editable={editable && m.state !== 'signed'} deletable={m.state === 'planned' && m.invitedOn === null} correctable={m.state === 'signed'} today={today} head={head} /> : null}
      />
      <div className="flex flex-col gap-6">
        {m.state !== 'cancelled' ? <MeetingWarnings warnings={[...m.warnings, ...(m.findings?.warnings ?? [])]} /> : null}
        {m.state !== 'cancelled' ? (
          <Steps density="compact" card steps={stepList} label={t('meeting.stepsLabel')} done={t('meeting.finished', { date: fmt.date(m.sealedAt ?? m.heldOn) })} collapsedWhenDone={{ label: t('meeting.showSteps') }} testId="meeting-steps" />
        ) : null}
        <AgendaSection
          meetingId={m.id}
          agenda={m.agenda}
          editable={editable}
          invited={m.state === 'invited'}
          supplementHref={assembly ? `/governance/meetings/${m.id}/invitation?kind=supplement` : null}
          onCreate={() => setDraft({ item: null })}
          onEdit={(item: AgendaItemView) => setDraft({ item })}
        />
        <MotionsCard
          meetingId={m.id}
          motions={m.motions}
          agenda={m.agenda}
          names={context.names}
          documentLabels={documentLabels}
          motionsBy={m.deadlines.motionsBy}
          motionDays={motionDays}
          today={today}
          editable={editable}
          canPickContacts={perms.contacts}
          canPickDocuments={perms.dms}
          onAdmit={(motion: MotionView) => setDraft({ item: null, motion: { id: motion.id, text: motion.text } })}
        />
        {documents}
      </div>
      {draft ? <AgendaItemDialog meetingId={m.id} draft={draft} context={context} statutes={statutes} documentLabels={documentLabels} canPickDocuments={perms.dms} onClose={() => setDraft(null)} /> : null}
    </>
  );
}
