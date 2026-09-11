'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { idleState } from '@/lib/actions';
import { receiveDocumentAction, suggestClassificationAction } from '../actions';

export function ReceiveForm({
  types,
  folders,
  contacts,
  defaultTypeKey,
}: {
  types: { key: string; label: string }[];
  folders: string[];
  contacts: { id: string; name: string }[];
  /** Die eingestellte Vorgabeart für den Eingang, keine Konstante im Code. */
  defaultTypeKey: string;
}) {
  const t = useTranslations('dms');
  const tCommon = useTranslations('common');
  const [state, formAction] = useActionState(receiveDocumentAction, idleState);

  const [documentDate, setDocumentDate] = useState('');
  const [subject, setSubject] = useState('');
  const [typeKey, setTypeKey] = useState(defaultTypeKey);
  const [folder, setFolder] = useState('');
  const [senderId, setSenderId] = useState('');

  const errors = state.status === 'error' ? state.fieldErrors : {};

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
    <form action={formAction} className="space-y-4 rounded-md border border-line bg-surface p-6">
      {state.status === 'error' && Object.keys(errors).length === 0 ? (
        <div role="alert" className="rounded-md bg-error-bg p-3 text-[13px] text-error">{state.message}</div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="file">{t('fields.file')}</Label>
        <Input id="file" name="file" type="file" accept="application/pdf" required onChange={handleFileChange} />
        {errors.file ? null : <p className="text-[12px] text-muted-ink">{t('fileHint')}</p>}
        <FieldError id="file-error" message={errors.file} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="documentDate">{t('fields.documentDate')}</Label>
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
          <Label htmlFor="typeKey">{t('fields.type')}</Label>
          <select
            id="typeKey"
            name="typeKey"
            value={typeKey}
            onChange={(e) => setTypeKey(e.target.value)}
            className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
          >
            {types.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="subject">{t('fields.subject')}</Label>
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
          <select
            id="folder"
            name="folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
          >
            <option value="">{t('inbox')}</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="senderId">{t('fields.sender')}</Label>
          <select
            id="senderId"
            name="senderId"
            value={senderId}
            onChange={handleSenderChange}
            className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
          >
            <option value="">{t('fields.noSender')}</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <FormActionBar back={{ href: '/dms', label: tCommon('backToList') }} saveLabel={t('receiveSubmit')} />
    </form>
  );
}
