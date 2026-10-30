'use client';

import type { MotionView } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { saveMotionAction } from './actions';

/** Antrag erfassen oder bearbeiten (Board 2b B, `md`): gestellt von, Eingang, Text, Dokument (`saveMotion`). */
export function MotionDialog({ meetingId, motion, names, today, canPickContacts, canPickDocuments, documentLabel, onClose }: { meetingId: string; motion: MotionView | null; names: Record<string, string>; today: string; canPickContacts: boolean; canPickDocuments: boolean; documentLabel: string | null; onClose: () => void }) {
  const t = useTranslations('governance.motions.dialog');
  const router = useRouter();
  const [contact, setContact] = useState<PickedContact | null>(motion?.submittedByContactId ? { id: motion.submittedByContactId, name: names[motion.submittedByContactId] ?? '' } : null);
  const [receivedOn, setReceivedOn] = useState(motion?.receivedOn ?? today);
  const [text, setText] = useState(motion?.text ?? '');
  const [document, setDocument] = useState<PickedDocument | null>(motion?.documentId ? { id: motion.documentId, number: null, subject: documentLabel ?? '', phase: 'issued' } : null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const save = async () => {
    setPending(true);
    const result = await feedback.run(
      () => saveMotionAction({ ...(motion ? { id: motion.id, agendaItemId: motion.agendaItemId, withdrawnOn: motion.withdrawnOn } : {}), meetingId, submittedByContactId: contact?.id ?? motion?.submittedByContactId ?? null, receivedOn, text, documentId: document?.id ?? null }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status !== 'success') return;
    onClose();
    router.refresh();
  };

  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{motion ? t('editTitle') : t('createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <DialogBody>
            <FormGrid>
              {canPickContacts ? (
                <FormCell size="m">
                  <ContactPicker id="motion-contact" name="submittedByContactId" label={t('submittedBy')} value={contact} onChange={setContact} />
                </FormCell>
              ) : null}
              <FormField id="motion-received" label={t('receivedOn')} required size="s" error={errors.receivedOn}>
                <Input id="motion-received" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
              </FormField>
              <FormField id="motion-text" label={t('text')} required size="full" error={errors.text}>
                <Textarea id="motion-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
              </FormField>
              {canPickDocuments ? (
                <FormCell size="full">
                  <DocumentPicker id="motion-document" name="documentId" label={t('document')} value={document} onChange={setDocument} />
                </FormCell>
              ) : null}
            </FormGrid>
          </DialogBody>
        </form>
        <FormActionBar placement="dialog" mode={motion ? 'edit' : 'create'} cancel={onClose} pending={pending} onSave={() => void save()} state={feedback.state} testId="motion-footer" />
      </DialogContent>
    </Dialog>
  );
}
