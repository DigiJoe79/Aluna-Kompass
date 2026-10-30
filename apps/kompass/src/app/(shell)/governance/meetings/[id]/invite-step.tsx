'use client';

import type { InvitationCompliance, InvitationDispatchState, InvitationRunView, NoticeDeadline } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { RunProgress } from '@/app/(shell)/members/runs/run-progress';
import { useDateFormat } from '@/components/date-format-provider';
import { DispatchStep } from '@/components/dispatch-step';
import { buttonVariants } from '@/components/ui/button';
import { markInvitationPostAction, moveInvitationLettersAction, resendInvitationMailAction, sendInvitationMailsAction } from './actions';
import type { StepSlot } from './meeting-view';

/** Satz zur Einladungsfrist (Board 2a): „Einladungsfrist 14 Tage (laut Satzung): spätestens am … absenden.“ */
export function useInviteDeadline() {
  const tg = useTranslations('governance');
  const { date } = useDateFormat();
  return (d: NoticeDeadline) => {
    const sendBy = d.sendBy.post ?? d.lastReceiptDay;
    if (d.noticeDays === null || !sendBy) return tg('invite.deadlineNone', { date: date(d.lawHintDay) });
    return tg('invite.deadline', { days: d.noticeDays, source: d.source === 'statute' ? tg('majority.sourceStatute') : tg('majority.sourceLaw', { norm: d.norm ?? '' }), date: date(sendBy) });
  };
}

/**
 * Schritt 2 der Mitgliederversammlung (Plan U1 Task 6, Board 2a/2d): Frist als Satz; ohne Lauf „Einladung
 * vorbereiten“ (Serienlauf-Seite); ein laufender Lauf zeigt den Fortschritt, danach den Versand mit Namen. Erledigt:
 * „{n} Briefe am …, Frist gewahrt.“ Frühere Läufe (Nachtrag, Absage) stehen darunter.
 */
export function useInviteStep({
  meetingId,
  invitedOn,
  deadline,
  runs,
  runRefPrefix,
  dispatch,
  compliance,
  canManage,
  preparing,
  today,
}: {
  meetingId: string;
  invitedOn: string | null;
  deadline: NoticeDeadline;
  runs: InvitationRunView[];
  runRefPrefix: string;
  dispatch: InvitationDispatchState | null;
  compliance: InvitationCompliance | null;
  canManage: boolean;
  preparing: boolean;
  today: string;
}): StepSlot {
  const t = useTranslations('governance.invite');
  const { date } = useDateFormat();
  const deadlineText = useInviteDeadline()(deadline);
  const run = runs.filter((r) => r.kind === 'invitation').at(-1);
  const earlier = runs.filter((r) => r !== run);
  const earlierList =
    earlier.length > 0 ? (
      <ul className="flex flex-col text-meta text-ink-2" data-testid="invitation-earlier">
        {earlier.map((r) => (
          <li key={r.id} className="border-t border-line-2 py-1.5">{t('earlier', { kind: t(`runKinds.${r.kind}`), date: date(r.issuedOn), count: r.issued })}</li>
        ))}
      </ul>
    ) : null;

  if (!run) {
    return {
      detail: deadlineText,
      below:
        canManage && preparing ? (
          <div className="flex flex-col gap-2">
            <div>
              <Link href={`/governance/meetings/${meetingId}/invitation`} className={buttonVariants()} data-testid="invitation-prepare">{t('prepare')}</Link>
            </div>
            {earlierList}
          </div>
        ) : (earlierList ?? undefined),
    };
  }
  if (run.status === 'running') {
    return {
      detail: t('running'),
      below: <RunProgress url={`/governance/meetings/${meetingId}/invitation/${run.id}/continue`} kind="letters" initial={{ done: run.issued, total: run.issued + run.pending }} canContinue={canManage} />,
    };
  }
  const doneText = compliance && invitedOn ? (compliance.ok === null ? t('doneNoDeadline', { count: compliance.letters, date: date(invitedOn) }) : t(compliance.ok ? 'done' : 'doneShort', { count: compliance.letters, date: date(invitedOn) })) : deadlineText;
  return {
    detail: dispatch?.done ? doneText : deadlineText,
    below: (
      <div className="flex flex-col gap-3">
        {dispatch && !dispatch.done ? (
          <DispatchStep
            mail={dispatch.mail.map((m) => ({ documentId: m.documentId, documentNumber: m.documentNumber, name: m.name, detail: null, sentAt: m.sentAt, address: m.address, state: m.state, outboxId: m.outboxId, errorText: m.errorText, errorCode: m.errorCode }))}
            post={dispatch.post.map((p) => ({ documentId: p.documentId, documentNumber: p.documentNumber, name: p.name, detail: null, sentAt: p.sentAt, reason: p.reason, dispatched: p.dispatched }))}
            done={dispatch.done}
            mailState={dispatch.mailState}
            canSend={canManage}
            canMark={canManage}
            today={today}
            printHref={`/governance/meetings/invitation-print?runId=${encodeURIComponent(run.id)}`}
            documentHref={(id) => `/dms/${id}`}
            onSendAll={() => sendInvitationMailsAction(meetingId, run.id)}
            onMark={(documentIds, sentAt) => markInvitationPostAction(meetingId, { runId: run.id, documentIds, sentAt })}
            onResend={(outboxId) => resendInvitationMailAction(outboxId)}
            onMove={(documentIds, to) => moveInvitationLettersAction(meetingId, { runId: run.id, documentIds, to })}
            runRef={runRefPrefix + run.id}
          />
        ) : null}
        {earlierList}
      </div>
    ),
  };
}
