'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { endTermAction } from '../actions';

/** „Amtszeit beenden …“ (`md`): Bis, Grund, bei Rücktritt der Zugang der Niederlegung (§ 26 Abs. 2 S. 2 BGB), Nachweis. */
export function TermEndDialog({ organId, term, reasons, today, canPickDocuments, onClose, finalFocus }: { organId: string; term: { id: string; name: string; officeName: string }; reasons: readonly string[]; today: string; canPickDocuments: boolean; onClose: () => void; finalFocus?: RefObject<HTMLElement | null> }) {
  const t = useTranslations('governance.termEnd');
  const router = useRouter();
  const [until, setUntil] = useState(today);
  const [reason, setReason] = useState<string>('resigned');
  const [receivedOn, setReceivedOn] = useState(today);
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => endTermAction(organId, { id: term.id, until, reason, ...(reason === 'resigned' ? { receivedOn } : {}), ...(document ? { documentId: document.id } : {}) }), { retry: () => void save() });
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
          <DialogTitle>{t('title', { name: term.name, office: term.officeName })}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <DialogBody>
            <FormGrid>
              <FormField id="term-until" label={t('until')} required size="s" error={errors.until}>
                <Input id="term-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
              </FormField>
              <FormField id="term-reason" label={t('reason')} required error={errors.reason}>
                <Select id="term-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {reasons.map((r) => (
                    <option key={r} value={r}>{t(`reasons.${r}`)}</option>
                  ))}
                </Select>
              </FormField>
              {reason === 'resigned' ? (
                <FormField id="term-received" label={t('receivedOn')} hint={t('receivedOnHint')} required size="s" error={errors.receivedOn}>
                  <Input id="term-received" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
                </FormField>
              ) : null}
              {canPickDocuments ? (
                <FormCell size="full">
                  <DocumentPicker id="term-document" name="documentId" label={t('proof')} value={document} onChange={setDocument} />
                </FormCell>
              ) : null}
              {reason === 'resigned' && !document ? (
                <FormCell size="full">
                  <Notice level="warn">{t('resignationDocumentMissing')}</Notice>
                </FormCell>
              ) : null}
            </FormGrid>
          </DialogBody>
        </form>
        <FormActionBar placement="dialog" mode="create" cancel={onClose} pending={pending} onSave={() => void save()} state={feedback.state} saveLabel={t('save')} />
      </DialogContent>
    </Dialog>
  );
}
