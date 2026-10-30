'use client';

import type { CircularAnswer } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { saveCircularResponseAction } from '../actions';

const ANSWERS = ['yes', 'no', 'abstain', 'none'] as const;

/** „Antwort eintragen …“ (`md`): Antwort, Tag, Nachweis aus der Akte oder ein Vermerk. */
export function ResponseDialog({ circularId, response, name, today, canPickDocuments, onClose }: { circularId: string; response: { id: string; answer: CircularAnswer; answeredOn: string | null; documentId: string | null; documentLabel: string | null; note: string | null }; name: string; today: string; canPickDocuments: boolean; onClose: () => void }) {
  const t = useTranslations('governance.circular');
  const router = useRouter();
  const [answer, setAnswer] = useState<CircularAnswer>(response.answer === 'none' ? 'yes' : response.answer);
  const [on, setOn] = useState(response.answeredOn ?? today);
  const [doc, setDoc] = useState<PickedDocument | null>(response.documentId ? { id: response.documentId, number: null, subject: response.documentLabel ?? '', phase: 'issued' } : null);
  const [note, setNote] = useState(response.note ?? '');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => saveCircularResponseAction(circularId, { id: response.id, answer, answeredOn: answer === 'none' ? null : on || null, documentId: doc?.id ?? null, note: note.trim() || null }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message ?? '');
    onClose();
    router.refresh();
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('responseTitle', { name })}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <DialogBody>
            <FormGrid>
              <FormField id="response-answer" label={t('answer')} required size="full">
                <Segmented<CircularAnswer> className="self-start" aria-label={t('answer')} value={answer} onValueChange={setAnswer} options={ANSWERS.map((a) => ({ value: a, label: t(`answers.${a}`), testId: `answer-${a}` }))} />
              </FormField>
              <FormField id="response-on" label={t('answeredOn')} size="s" error={errors.answeredOn}>
                <Input id="response-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
              </FormField>
              {canPickDocuments ? (
                <FormCell size="full">
                  <DocumentPicker id="response-doc" name="documentId" label={t('proof')} value={doc} onChange={setDoc} />
                </FormCell>
              ) : null}
              <FormField id="response-note" label={t('note')} size="full" error={errors.note}>
                <Input id="response-note" value={note} placeholder={t('notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
              </FormField>
            </FormGrid>
          </DialogBody>
        </form>
        <FormActionBar placement="dialog" mode="create" cancel={onClose} pending={pending} onSave={() => void save()} state={feedback.state} saveLabel={t('responseSave')} saveTestId="response-save" />
      </DialogContent>
    </Dialog>
  );
}
