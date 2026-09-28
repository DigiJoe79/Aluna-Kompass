'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/actions';
import { rejectExpenseClaimAction } from '../expenses/actions';

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (note.trim() === '') {
      setMissing(true);
      return;
    }
    setBusy(true);
    setError(null);
    const state = onReject ? await onReject(note.trim()) : await rejectExpenseClaimAction(claimId ?? '', note.trim());
    setBusy(false);
    if (state.status === 'success') {
      onOpenChange(false);
      router.refresh();
      return;
    }
    if (state.status === 'error') setError(state.message);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title ?? t('title', { number })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-[14px] text-ink-2">{who ?? t('who', { name: person })}</p>
          <Label htmlFor="reject-note">{t('reason')}</Label>
          <Textarea
            id="reject-note"
            rows={3}
            maxLength={1000}
            value={note}
            aria-invalid={missing || undefined}
            aria-describedby={missing ? 'reject-note-missing' : undefined}
            onChange={(e) => {
              setNote(e.target.value);
              setMissing(false);
            }}
          />
          {missing ? (
            <p id="reject-note-missing" role="alert" className="text-[12px] text-error">
              {t('required')}
            </p>
          ) : null}
          {error ? (
            <Notice level="refuse" title={t('confirm')}>
              {error}
            </Notice>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={busy} onClick={() => void confirm()}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
