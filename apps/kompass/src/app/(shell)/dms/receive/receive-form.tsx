'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { idleState } from '@/lib/actions';
import { receiveDocumentAction, suggestClassificationAction } from '../actions';
import { Select } from '@/components/ui/select';
import { FileDropzone } from './file-dropzone';

export function ReceiveForm({
  types,
  folders,
  contacts,
  defaultTypeKey,
  onCancel,
}: {
  types: { key: string; label: string }[];
  folders: string[];
  contacts: { id: string; name: string }[];
  /** Die eingestellte Vorgabeart für den Eingang, keine Konstante im Code. */
  defaultTypeKey: string;
  /** Gesetzt, wenn das Formular in einem Dialog steht. */
  onCancel?: () => void;
}) {
  const t = useTranslations('dms');
  const [state, formAction] = useActionState(receiveDocumentAction, idleState);

  const [documentDate, setDocumentDate] = useState('');
  const [subject, setSubject] = useState('');
  const [typeKey, setTypeKey] = useState(defaultTypeKey);
  const [folder, setFolder] = useState('');
  const [senderId, setSenderId] = useState('');
  const [hasFile, setHasFile] = useState(false);

  const errors = state.status === 'error' ? state.fieldErrors : {};

  const handleFile = async (file: File | null) => {
    setHasFile(!!file);
    if (!file) return;

    const suggestion = await suggestClassificationAction(file.name, senderId || undefined);
    if (suggestion) {
      if (suggestion.documentDate) setDocumentDate(suggestion.documentDate);
      if (suggestion.typeKey) setTypeKey(suggestion.typeKey);
      if (suggestion.folder !== undefined && suggestion.folder !== null) setFolder(suggestion.folder);
    }
  };

  const handleSenderChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSenderId = e.target.value;
    setSenderId(newSenderId);
    const fileInput = document.getElementById('file') as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (file) {
      const suggestion = await suggestClassificationAction(file.name, newSenderId || undefined);
      if (suggestion) {
        if (suggestion.documentDate) setDocumentDate(suggestion.documentDate);
        if (suggestion.typeKey) setTypeKey(suggestion.typeKey);
        if (suggestion.folder !== undefined && suggestion.folder !== null) setFolder(suggestion.folder);
      }
    }
  };

  return (
    <form action={formAction} className="flex min-h-0 flex-col">
      {/* Der Körper scrollt, die Fußleiste bleibt stehen. */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
      {state.status === 'error' && Object.keys(errors).length === 0 ? (
        <div role="alert" className="rounded-md bg-error-bg p-3 text-[13px] text-error">{state.message}</div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="file" required>{t('fields.file')}</Label>
        <FileDropzone id="file" name="file" required onFile={handleFile} />
        <FieldError id="file-error" message={errors.file} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="documentDate" required>{t('fields.documentDate')}</Label>
          <Input
            id="documentDate"
            name="documentDate"
            type="date"
            required
            value={documentDate}
            onChange={(e) => setDocumentDate(e.target.value)}
          />
          <FieldError id="documentDate-error" message={errors.documentDate} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="typeKey" required>{t('fields.type')}</Label>
          <Select
            id="typeKey"
            name="typeKey"
            required
            value={typeKey}
            onChange={(e) => setTypeKey(e.target.value)}
          >
            {types.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="subject" required>{t('fields.subject')}</Label>
        <Input
          id="subject"
          name="subject"
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <FieldError id="subject-error" message={errors.subject} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="folder">{t('fields.folder')}</Label>
          <Select
            id="folder"
            name="folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          >
            <option value="">{t('inbox')}</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="senderId">{t('fields.sender')}</Label>
          <Select
            id="senderId"
            name="senderId"
            value={senderId}
            onChange={handleSenderChange}
          >
            <option value="">{t('fields.noSender')}</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      </div>
      <FormActionBar cancel={onCancel} sticky={false} saveLabel={t('receiveSubmit')} saveDisabled={!hasFile} />
    </form>
  );
}
