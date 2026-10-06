'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/actions';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { rejectExpenseClaimAction } from '../expenses/actions';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';

/**
 * Ablehnen mit Pflichtgrund (Designer-README 3h). Der Satz sagt, wer den Grund
 * liest: die antragstellende Person, in ihren eigenen Anträgen. Der Grund
 * steht am Antrag, nie im Änderungsprotokoll.
 *
 * Design-Nachtrag Phase 4: dieselbe Ablehnung für Zahlungen an Partner und
 * „Zweck ändern“ — `onReject` ersetzt dann die Ablehnung der Auslage, `title`
 * und `who` die Sätze.
 */
export function RejectDialog({
  open,
  onOpenChange,
  claimId,
  number,
  person,
  title,
  who,
  onReject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimId?: string;
  number: string;
  person: string;
  title?: string;
  who?: string;
  onReject?: (note: string) => Promise<ActionState>;
}) {
  const t = useTranslations('finance.approvals.reject');
  const router = useRouter();
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const feedback = useActionFeedback();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (note.trim() === '') {
      setMissing(true);
      return;
    }
    setBusy(true);
    const state = await feedback.run(() => (onReject ? onReject(note.trim()) : rejectExpenseClaimAction(claimId ?? '', note.trim())), { retry: () => void confirm() });
    setBusy(false);
    if (state.status === 'success') {
      onOpenChange(false);
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title ?? t('title', { number })}</DialogTitle>
        </DialogHeader>
        <p className="text-[14px] text-ink-2">{who ?? t('who', { name: person })}</p>
        <FormGrid>
          <FormField id="reject-note" label={t('reason')} error={missing ? t('required') : undefined} size="l">
            <Textarea
              id="reject-note"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setMissing(false);
              }}
            />
          </FormField>
        </FormGrid>
        <FormActionBar placement="dialog" cancel={() => onOpenChange(false)} pending={busy} saveLabel={t('confirm')} onSave={() => void confirm()} state={withUnplacedFieldErrors(feedback.state, [])} />
      </DialogContent>
    </Dialog>
  );
}
