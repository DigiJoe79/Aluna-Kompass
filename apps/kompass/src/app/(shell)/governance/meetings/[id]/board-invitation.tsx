'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { issueBoardInvitationAction, recordInvitationNoteAction, sendBoardInvitationAction } from './actions';
import type { StepSlot } from './meeting-view';

const link = 'text-link underline-offset-2 hover:underline';

/**
 * Schritt 2 für Vorstand und andere Organe (Spec § 5.3, Plan U1 Task 6): kein Serienlauf — eine Einladung ausstellen
 * und per E-Mail an die Amtsinhaber senden, oder nur vermerken („eingeladen am … per Messenger“).
 */
export function useBoardInvitationStep({ meetingId, invitedOn, documentId, documentNumber, note, deadlineText, canManage, preparing, today }: { meetingId: string; invitedOn: string | null; documentId: string | null; documentNumber: string | null; note: string | null; deadlineText: string; canManage: boolean; preparing: boolean; today: string }): StepSlot {
  const t = useTranslations('governance.invite.board');
  const { date } = useDateFormat();
  const router = useRouter();
  const feedback = useActionFeedback();
  const [pending, setPending] = useState(false);
  const [noting, setNoting] = useState(false);
  const [noteOn, setNoteOn] = useState(today);
  const [noteText, setNoteText] = useState('');
  const run = async (fn: () => ReturnType<typeof issueBoardInvitationAction>) => {
    setPending(true);
    const result = await feedback.run(fn);
    setPending(false);
    if (result.status === 'success') router.refresh();
  };
  const noteDialog = (
    <ConfirmDialog
      open={noting}
      onOpenChange={setNoting}
      title={t('noteDialog.title')}
      description={t('noteDialog.description')}
      confirmLabel={t('noteDialog.confirm')}
      action={async () => {
        const result = await recordInvitationNoteAction({ meetingId, invitedOn: noteOn, note: noteText });
        if (result.status === 'success') router.refresh();
        return result;
      }}
    >
      <FormGrid>
        <FormField id="invite-note-on" label={t('noteDialog.invitedOn')} required size="s">
          <Input id="invite-note-on" type="date" value={noteOn} onChange={(e) => setNoteOn(e.target.value)} />
        </FormField>
        <FormField id="invite-note" label={t('noteDialog.note')} required size="full">
          <Input id="invite-note" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
        </FormField>
      </FormGrid>
    </ConfirmDialog>
  );

  if (invitedOn && note && !documentId) return { detail: t('doneNote', { date: date(invitedOn), note }) };
  if (invitedOn && documentId) {
    return {
      detail: (
        <>
          <Link href={`/dms/${documentId}`} className={`${link} font-mono`}>{documentNumber ?? ''}</Link> {t('doneDocument', { date: date(invitedOn) })}
        </>
      ),
      below:
        canManage && preparing ? (
          <div className="flex flex-col gap-2">
            <div>
              <Button type="button" variant="outline" disabled={pending} onClick={() => void run(() => sendBoardInvitationAction(meetingId))} data-testid="board-invitation-send">{t('send')}</Button>
            </div>
            <RefusalNotice action state={feedback.state} />
          </div>
        ) : undefined,
    };
  }
  return {
    detail: deadlineText,
    below:
      canManage && preparing ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={() => void run(() => issueBoardInvitationAction(meetingId))} data-testid="board-invitation-issue">{t('issue')}</Button>
            <Button type="button" variant="outline" onClick={() => { setNoteOn(today); setNoteText(''); setNoting(true); }}>{t('note')}</Button>
          </div>
          <RefusalNotice action state={feedback.state} />
          {noteDialog}
        </div>
      ) : undefined,
  };
}
