'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Notice } from '@/components/notice';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { carryOverAction } from './actions';

/**
 * „In das Folgejahr übernehmen“ bestätigen (Board 10c, Dialog `md`): Folge als Satz, Begründung Pflicht. Ist die
 * Steuererklärung des Jahres schon abgegeben (Schritt 12), steht der Hinweis auf § 153 AO darüber (E6a, C1 5).
 */
export function CarryOverDialog({ open, onOpenChange, fiscalYearId, year, next, taxReturnFiled = false }: { open: boolean; onOpenChange: (open: boolean) => void; fiscalYearId: string; year: string; next: string; taxReturnFiled?: boolean }) {
  const t = useTranslations('finance.closing.carryOverDialog');
  const router = useRouter();
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  useEffect(() => {
    if (!open) return;
    setNote('');
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => carryOverAction(fiscalYearId, note), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(t('done', { next }));
    onOpenChange(false);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="closing-carry-over-dialog">
        <DialogHeader>
          <DialogTitle>{t('title', { year, next })}</DialogTitle>
          <DialogDescription tone="body">{t('description', { next })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {taxReturnFiled ? (
            <Notice level="hint" testId="closing-carry-over-section153">
              {t('section153', { year })}
            </Notice>
          ) : null}
          <FormField id="closing-carry-over-note" label={t('note')} hint={t('hint')} required error={fieldErrors.note} size="full">
            <Textarea id="closing-carry-over-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </FormField>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('save')} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['note'])} testId="closing-carry-over-footer" />
      </DialogContent>
    </Dialog>
  );
}
