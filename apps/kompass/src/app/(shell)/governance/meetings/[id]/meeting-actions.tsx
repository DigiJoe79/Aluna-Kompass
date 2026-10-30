'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { RecordActions } from '@/components/record-actions';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { updateMeetingAction } from '../actions';
import { MeetingHeadFields, type MeetingHeadFieldsProps } from '../meeting-head-fields';
import { cancelMeetingAction, correctMinutesAction, deleteMeetingAction } from './actions';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { FormCell, FormGrid } from '@/components/forms/form-grid';

/**
 * ⋯ am Kopf der Sitzung (MUSTER § C, Plan U1 Task 5): „Angaben ändern …“ und „Absagen …“ bis zum Beginn, „Löschen …“
 * nur geplant und ohne Einladung. Je Aktion ein gesteuerter Dialog, Fokus zurück auf ⋯.
 */
export function MeetingActions({ meetingId, editable, deletable, correctable = false, today, head }: { meetingId: string; editable: boolean; deletable: boolean; correctable?: boolean; today: string; head: Omit<MeetingHeadFieldsProps, 'errors'> }) {
  const t = useTranslations('governance.meeting');
  const router = useRouter();
  const more = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [cancelledOn, setCancelledOn] = useState(today);
  const [reason, setReason] = useState('');

  const cancel = async () => {
    const result = await cancelMeetingAction({ id: meetingId, cancelledOn, reason });
    if (result.status === 'success') {
      const lettersDue = (result.data as { lettersDue?: boolean } | undefined)?.lettersDue;
      toast.success(result.message ?? '', lettersDue ? { action: { label: t('cancelDialog.letters'), onClick: () => router.push(`/governance/meetings/${meetingId}/invitation?kind=cancellation`) } } : undefined);
      router.refresh();
    }
    return result;
  };

  return (
    <>
      <RecordActions
        triggerRef={more}
        testId="meeting-more"
        actions={[
          { key: 'edit', label: t('more.edit'), kind: 'reversible', onSelect: () => setEditing(true), hidden: !editable, testId: 'meeting-edit' },
          { key: 'cancel', label: t('more.cancel'), kind: 'undoing', onSelect: () => setCancelling(true), hidden: !editable, testId: 'meeting-cancel' },
          { key: 'correct', label: t('more.correct'), kind: 'undoing', onSelect: () => setCorrecting(true), hidden: !correctable, testId: 'meeting-correct' },
          { key: 'delete', label: t('more.delete'), kind: 'delete', onSelect: () => setDeleting(true), hidden: !deletable, testId: 'meeting-delete' },
        ]}
      />
      {correcting ? <CorrectDialog meetingId={meetingId} onClose={() => setCorrecting(false)} finalFocus={more} /> : null}
      {editing ? <EditDialog meetingId={meetingId} head={head} onClose={() => setEditing(false)} finalFocus={more} /> : null}
      <ConfirmDialog open={cancelling} onOpenChange={setCancelling} title={t('cancelDialog.title')} description={t('cancelDialog.description')} confirmLabel={t('cancelDialog.confirm')} finalFocus={more} action={cancel}>
        <FormGrid>
          <FormField id="cancel-on" label={t('cancelDialog.on')} required size="s">
            <Input id="cancel-on" type="date" value={cancelledOn} onChange={(e) => setCancelledOn(e.target.value)} />
          </FormField>
          <FormField id="cancel-reason" label={t('cancelDialog.reason')} required size="full">
            <Textarea id="cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </FormGrid>
      </ConfirmDialog>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={t('deleteDialog.title')} description={t('deleteDialog.description')} confirmLabel={t('deleteDialog.confirm')} destructive finalFocus={more} action={() => deleteMeetingAction(meetingId)} />
    </>
  );
}

function EditDialog({ meetingId, head, onClose, finalFocus }: { meetingId: string; head: Omit<MeetingHeadFieldsProps, 'errors'>; onClose: () => void; finalFocus: React.RefObject<HTMLButtonElement | null> }) {
  const t = useTranslations('governance.meeting');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const save = async () => {
    if (!form.current) return;
    const data = new FormData(form.current);
    data.set('id', meetingId);
    setPending(true);
    const result = await feedback.run(() => updateMeetingAction(data), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onClose();
    router.refresh();
  };
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="lg" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
        </DialogHeader>
        <form ref={form} onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <DialogBody>
            <MeetingHeadFields {...head} errors={errors} />
          </DialogBody>
        </form>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} onSave={() => void save()} state={feedback.state} testId="meeting-edit-footer" />
      </DialogContent>
    </Dialog>
  );
}


/** „Berichtigen …“ (`md`): Grund und die neue unterschriebene Fassung; die vorige bleibt in der Akte. */
function CorrectDialog({ meetingId, onClose, finalFocus }: { meetingId: string; onClose: () => void; finalFocus: React.RefObject<HTMLButtonElement | null> }) {
  const t = useTranslations('governance.meeting');
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    const data = new FormData();
    data.set('meetingId', meetingId);
    data.set('reason', reason);
    if (file) data.set('file', file);
    setPending(true);
    const result = await feedback.run(() => correctMinutesAction(data), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message ?? '');
    onClose();
    router.refresh();
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t('correctDialog.title')}</DialogTitle>
          <DialogDescription tone="body">{t('correctDialog.description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="correct-reason" label={t('correctDialog.reason')} required size="full" error={errors.reason}>
              <Textarea id="correct-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
            <FormCell size="full">
              <ReceiptDrop onFiles={(files) => setFile(files[0] ?? null)} disabled={pending} />
              {file ? <p className="mt-1 text-meta text-muted-ink">{file.name}</p> : null}
            </FormCell>
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="create" cancel={onClose} pending={pending} onSave={() => void save()} state={feedback.state} saveLabel={t('correctDialog.save')} />
      </DialogContent>
    </Dialog>
  );
}
