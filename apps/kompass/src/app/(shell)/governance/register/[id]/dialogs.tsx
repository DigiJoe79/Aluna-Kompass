'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ActionState } from '@/lib/actions';

export type FilingDialog =
  | { kind: 'notary' }
  | { kind: 'renotarize'; index: number }
  | { kind: 'submitted' }
  | { kind: 'interim' }
  | { kind: 'resolveInterim'; index: number }
  | { kind: 'complete' }
  | { kind: 'attach'; key: string; title: string }
  | { kind: 'confirmation' };

export interface FilingDialogValues {
  day: string;
  deadline: string;
  notary: PickedContact | null;
  document: PickedDocument | null;
  court: string;
  number: string;
}

/**
 * Die Dialoge der Registeranmeldung (Board 8b): Beglaubigung, Einreichung, Zwischenverfügung, erledigt, Eintragung,
 * Unterlage beifügen. Eine Maske je Art; Ablehnungen bleiben im Dialog.
 */
export function FilingDialogView({ dialog, today, register, canPickContacts, canPickDocuments, submit, onClose }: { dialog: FilingDialog; today: string; register: { court: string; number: string }; canPickContacts: boolean; canPickDocuments: boolean; submit: (d: FilingDialog, v: FilingDialogValues) => Promise<ActionState>; onClose: () => void }) {
  const t = useTranslations('governance.register.dialogs');
  const router = useRouter();
  const [v, setV] = useState<FilingDialogValues>({ day: today, deadline: '', notary: null, document: null, court: register.court, number: register.number });
  const set = (patch: Partial<FilingDialogValues>) => setV((x) => ({ ...x, ...patch }));
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => submit(dialog, v), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message ?? '');
    onClose();
    router.refresh();
  };
  const day = (label: string, error?: string) => (
    <FormField id="filing-day" label={label} required size="s" error={error}>
      <Input id="filing-day" type="date" value={v.day} onChange={(e) => set({ day: e.target.value })} />
    </FormField>
  );
  const doc = (label: string) =>
    canPickDocuments ? (
      <FormCell size="full">
        <DocumentPicker id="filing-document" name="documentId" label={label} value={v.document} onChange={(d) => set({ document: d })} />
      </FormCell>
    ) : null;
  let body: ReactNode = null;
  let size: 'sm' | 'md' = 'sm';
  let hint: string | null = null;
  switch (dialog.kind) {
    case 'notary':
      size = 'md';
      body = (
        <>
          {canPickContacts ? (
            <FormCell size="full"><ContactPicker id="filing-notary" name="notaryContactId" label={t('notary')} value={v.notary} onChange={(c) => set({ notary: c })} canCreate /></FormCell>
          ) : null}
          {day(t('notarizedOn'), errors.notarizedOn)}
        </>
      );
      break;
    case 'renotarize':
      body = day(t('notarizedOn'), errors.notarizedOn);
      hint = t('renotarizeHint');
      break;
    case 'submitted':
      body = day(t('submittedOn'), errors.submittedOn);
      break;
    case 'resolveInterim':
      body = day(t('resolvedOn'), errors.resolvedOn);
      break;
    case 'interim':
      size = 'md';
      body = (
        <>
          {day(t('interimOn'), errors.on)}
          <FormField id="filing-deadline" label={t('deadline')} size="s" error={errors.deadline}>
            <Input id="filing-deadline" type="date" value={v.deadline} onChange={(e) => set({ deadline: e.target.value })} />
          </FormField>
          {doc(t('interimDocument'))}
        </>
      );
      break;
    case 'complete':
      size = 'md';
      hint = t('completeHint');
      body = (
        <>
          {day(t('registeredOn'), errors.registeredOn)}
          <FormField id="filing-court" label={t('court')} error={errors.registerCourt}>
            <Input id="filing-court" value={v.court} onChange={(e) => set({ court: e.target.value })} />
          </FormField>
          <FormField id="filing-number" label={t('number')} size="s" error={errors.registerNumber}>
            <Input id="filing-number" value={v.number} onChange={(e) => set({ number: e.target.value })} />
          </FormField>
          {doc(t('extract'))}
        </>
      );
      break;
    case 'attach':
      size = 'md';
      body = doc(dialog.title);
      break;
    case 'confirmation':
      size = 'md';
      body = doc(t('confirmation'));
      break;
  }
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>{dialog.kind === 'attach' ? t('attachTitle', { title: dialog.title }) : t(`titles.${dialog.kind}`)}</DialogTitle>
          {hint ? <DialogDescription>{hint}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <DialogBody>
            <FormGrid>{body}</FormGrid>
          </DialogBody>
        </form>
        <FormActionBar placement="dialog" mode="create" cancel={onClose} pending={pending} onSave={() => void save()} state={feedback.state} saveLabel={dialog.kind === 'attach' ? t('attach') : t(`saves.${dialog.kind}`)} saveTestId="filing-dialog-save" />
      </DialogContent>
    </Dialog>
  );
}
