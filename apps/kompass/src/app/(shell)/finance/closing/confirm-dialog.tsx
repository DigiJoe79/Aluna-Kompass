'use client';

import type { ClosingStepKey } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { confirmStepAction } from './actions';

/**
 * „<Schritt> <Jahr> bestätigen“ (Board 3b, Dialog `md`): das Ergebnis als Satz, „Begründung*“, „Bestätigen“. Die
 * Begründung steht danach unter dem Schritt und im Prüfpaket. Feldfehler am Feld, eine Ablehnung bleibt im Dialog.
 * `withoutNote` (Schritt 10, Nachprüfung ohne geänderte Buchung, Board 14d B): `sm`, eigener Titel, nur der Befund.
 */
export function StepConfirmDialog({
  open,
  onOpenChange,
  fiscalYearId,
  step,
  stepLabel,
  year,
  description,
  suggestion,
  withoutNote,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fiscalYearId: string;
  step: ClosingStepKey;
  stepLabel: string;
  year: string;
  description: string;
  /** Vorschlag für die Begründung (Schritt 12, Claude). */
  suggestion?: string;
  /** Ohne Begründung: den Befund liefert Kompass; mit eigenem Titel. */
  withoutNote?: { title: string };
}) {
  const t = useTranslations('finance.closing.confirmDialog');
  const router = useRouter();
  const [note, setNote] = useState(suggestion ?? '');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setNote(suggestion ?? '');
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};

  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => confirmStepAction(fiscalYearId, step, withoutNote ? null : note), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(t('done', { step: stepLabel }));
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={withoutNote ? 'sm' : 'md'} data-testid="closing-confirm-dialog">
        <DialogHeader>
          <DialogTitle>{withoutNote ? withoutNote.title : t('title', { step: stepLabel, year })}</DialogTitle>
          <DialogDescription tone="body">{description}</DialogDescription>
        </DialogHeader>
        {withoutNote ? null : (
          <DialogBody>
            <FormField id="closing-confirm-note" label={t('note')} hint={t('hint')} required error={fieldErrors.note} size="full">
              <Textarea id="closing-confirm-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
            </FormField>
          </DialogBody>
        )}
        <FormActionBar
          placement="dialog"
          mode="run"
          cancel={() => onOpenChange(false)}
          pending={pending}
          saveLabel={t('save')}
          onSave={() => void save()}
          state={withUnplacedFieldErrors(feedback.state, ['note'])}
          testId="closing-confirm-footer"
        />
      </DialogContent>
    </Dialog>
  );
}
