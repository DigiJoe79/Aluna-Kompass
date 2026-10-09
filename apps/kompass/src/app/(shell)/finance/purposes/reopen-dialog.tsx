'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type RefObject } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/actions';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';

/**
 * „Wieder öffnen …“ (Designer-README 4c, Annahme 7): Pflicht-Begründung, die am Zweck steht — nie im Änderungsprotokoll.
 * Gesteuert über `open`, eine Instanz; `finalFocus` gibt den Fokus nach dem Schließen an ⋯ zurück (Spec Seitenkopf § 3.4).
 */
export function ReopenDialog({ open, name, onClose, onConfirm, onDone, finalFocus }: { open: boolean; name: string; onClose: () => void; onConfirm: (reason: string) => Promise<ActionState>; onDone: () => void; finalFocus?: RefObject<HTMLElement | null> }) {
  const t = useTranslations('finance.purposes.reopenDialog');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const { reset } = feedback;
  // Jedes Öffnen beginnt leer.
  useEffect(() => {
    if (!open) return;
    setReason('');
    reset();
  }, [open, reset]);
  const confirm = async () => {
    setPending(true);
    const result = await feedback.run(() => onConfirm(reason.trim()), { retry: () => void confirm() });
    setPending(false);
    if (result.status === 'success') onDone();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="sm" className="bg-surface shadow-md" finalFocus={finalFocus}>
        <DialogTitle>
          {t('title')}: {name}
        </DialogTitle>
        <div data-testid="reopen-dialog">
          <FormGrid>
            <FormField id="purpose-reopen-reason" label={t('reason')} required hint={t('hint')} size="l">
              <Textarea id="purpose-reopen-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
          </FormGrid>
        </div>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={reason.trim() === ''} saveLabel={t('save')} saveTestId="reopen-save" onSave={() => void confirm()} state={feedback.state} />
      </DialogContent>
    </Dialog>
  );
}
