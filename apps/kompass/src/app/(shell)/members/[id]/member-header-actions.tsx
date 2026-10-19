'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { RecordActions } from '@/components/record-actions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { deleteMembershipAction, endMembershipAction, previewRecalculationAction, proposeResignationEndAction, rejectApplicationAction } from '../actions';
import { AdmitDialog } from './admit-dialog';

const END_REASONS = ['resignation', 'exclusion', 'struckOff', 'death', 'other'] as const;
type EndReason = (typeof END_REASONS)[number];

/**
 * Aktionen im Kopf der Mitglied-Seite (Handoff Mitglieder D1, MUSTER § C): beim offenen Antrag Primär „Aufnehmen …“,
 * im Menü ⋯ „Antrag ablehnen …“ und „Löschen …“; bei einer laufenden Mitgliedschaft ⋯ „Mitgliedschaft beenden …“ mit
 * Grund. „Ende zurücknehmen“ steht nicht hier, sondern an der Notice oben auf der Seite.
 */
export function MemberHeaderActions({ membershipId, name, status, today, canManage }: { membershipId: string; name: string; status: string; today: string; canManage: boolean }) {
  const t = useTranslations('members.detail');
  const ta = useTranslations('members.admit');
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<'admit' | 'reject' | 'delete' | 'end' | null>(null);
  const [rejectedOn, setRejectedOn] = useState(today);
  const [rejectLetter, setRejectLetter] = useState(true);
  if (!canManage) return null;
  const applied = status === 'applied';
  const running = status === 'active' || status === 'ending';
  if (!applied && !running) return null;
  const close = (open: boolean) => (open ? undefined : setDialog(null));

  return (
    <>
      {applied ? (
        <Button ref={trigger} type="button" onClick={() => setDialog('admit')} data-testid="member-admit">
          {ta('action')}
        </Button>
      ) : null}
      <RecordActions
        triggerRef={menu}
        actions={[
          { key: 'reject', label: t('actions.reject'), kind: 'undoing', onSelect: () => setDialog('reject'), hidden: !applied, testId: 'member-reject' },
          { key: 'end', label: t('actions.end'), kind: 'undoing', onSelect: () => setDialog('end'), hidden: !running, testId: 'member-end' },
          { key: 'delete', label: t('actions.delete'), kind: 'delete', onSelect: () => setDialog('delete'), hidden: !applied, testId: 'member-delete' },
        ]}
      />
      {dialog === 'admit' ? <AdmitDialog membershipId={membershipId} name={name} today={today} finalFocus={trigger} onClose={() => setDialog(null)} /> : null}
      <ConfirmDialog
        open={dialog === 'reject'}
        onOpenChange={close}
        finalFocus={menu}
        role="dialog"
        title={t('reject.title')}
        description={t('reject.description', { name })}
        confirmLabel={t('reject.confirm')}
        action={async () => {
          const result = await rejectApplicationAction({ membershipId, rejectedOn, letter: rejectLetter });
          if (result.status === 'success') {
            toast.success(result.message);
            router.refresh();
          }
          return result;
        }}
      >
        <FormGrid>
          <FormField id="reject-date" label={t('reject.date')} required size="s">
            <Input id="reject-date" type="date" value={rejectedOn} onChange={(e) => setRejectedOn(e.target.value)} />
          </FormField>
          <FormField id="reject-letter" label={t('reject.letter')} toggle size="full">
            <Checkbox id="reject-letter" checked={rejectLetter} onCheckedChange={(on) => setRejectLetter(on === true)} />
          </FormField>
        </FormGrid>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={close}
        finalFocus={menu}
        title={t('delete.title')}
        description={t('delete.description', { name })}
        confirmLabel={t('delete.confirm')}
        destructive
        action={async () => {
          const result = await deleteMembershipAction(membershipId);
          if (result.status === 'success') router.push('/members?view=applications');
          return result;
        }}
      />
      {dialog === 'end' ? <EndDialog membershipId={membershipId} name={name} today={today} finalFocus={menu} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

/** „Mitgliedschaft beenden …“ (Handoff D1): Grund, bei Austritt Kündigungstag und Ende nach der Frist; Folge für die Beiträge. */
function EndDialog({ membershipId, name, today, finalFocus, onClose }: { membershipId: string; name: string; today: string; finalFocus: React.RefObject<HTMLElement | null>; onClose: () => void }) {
  const t = useTranslations('members.detail');
  const router = useRouter();
  const [reason, setReason] = useState<EndReason>('resignation');
  const [noticeOn, setNoticeOn] = useState(today);
  // M11: Ein Ausschluss braucht das Dokument des Beschlusses aus der Akte.
  const [decision, setDecision] = useState<PickedDocument | null>(null);
  const [endsOn, setEndsOn] = useState('');
  const [letter, setLetter] = useState(true);
  const [plan, setPlan] = useState<{ replaced: number; kept: number } | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  // Bei Austritt schlägt der Dienst das Ende nach der Kündigungsfrist vor; ein anderer Grund endet vorgabemäßig heute.
  useEffect(() => {
    if (reason !== 'resignation') {
      setEndsOn(today);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(noticeOn)) return;
    let current = true;
    void proposeResignationEndAction(noticeOn).then((result) => {
      if (current && result.status === 'success') setEndsOn((result.data as { endsOn: string }).endsOn);
    });
    return () => {
      current = false;
    };
  }, [reason, noticeOn, today]);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return;
    let current = true;
    void previewRecalculationAction({ membershipId, from: endsOn, change: { kind: 'end', endsOn } }).then((result) => {
      if (current && result.status === 'success') setPlan(result.data as { replaced: number; kept: number });
    });
    return () => {
      current = false;
    };
  }, [membershipId, endsOn]);

  const submit = async () => {
    setPending(true);
    const result = await feedback.run(
      () => (reason === 'resignation' ? endMembershipAction({ membershipId, reason, noticeOn, endsOn, letter }) : endMembershipAction({ membershipId, reason, endsOn, documentId: reason === 'exclusion' ? (decision?.id ?? null) : null })),
      { retry: () => void submit() },
    );
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message);
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t('end.title')}</DialogTitle>
          <DialogDescription tone="body">{t('end.description', { name })}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <FormGrid>
            <FormField id="end-reason" label={t('end.reason')} required>
              <Select id="end-reason" value={reason} onChange={(e) => setReason(e.target.value as EndReason)}>
                {END_REASONS.map((r) => (
                  <option key={r} value={r}>{t(`reasons.${r}`)}</option>
                ))}
              </Select>
            </FormField>
            {reason === 'resignation' ? (
              <FormField id="end-notice" label={t('end.noticeOn')} required size="s">
                <Input id="end-notice" type="date" value={noticeOn} onChange={(e) => setNoticeOn(e.target.value)} />
              </FormField>
            ) : null}
            <FormField id="end-date" label={t('end.endsOn')} required size="s" hint={reason === 'resignation' ? t('end.endsOnHint') : undefined}>
              <Input id="end-date" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </FormField>
            {reason === 'exclusion' ? (
              <FormCell size="m">
                <DocumentPicker id="end-decision" name="decision" label={t('end.decision')} value={decision} onChange={setDecision} required />
              </FormCell>
            ) : null}
            {reason === 'resignation' ? (
              <FormField id="end-letter" label={t('end.letter')} toggle size="full">
                <Checkbox id="end-letter" checked={letter} onCheckedChange={(on) => setLetter(on === true)} />
              </FormField>
            ) : null}
          </FormGrid>
          {plan && (plan.replaced > 0 || plan.kept > 0) ? (
            <Notice level="hint" testId="end-recalc">
              {[plan.replaced > 0 ? t('recalcCancelled', { count: plan.replaced }) : null, plan.kept > 0 ? t('recalcKept', { count: plan.kept }) : null].filter(Boolean).join(' ')}
            </Notice>
          ) : null}
        </DialogBody>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!endsOn} saveLabel={t('end.confirm')} onSave={() => void submit()} state={feedback.state} testId="end-footer" />
      </DialogContent>
    </Dialog>
  );
}
