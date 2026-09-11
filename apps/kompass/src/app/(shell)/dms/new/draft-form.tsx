'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { idleState } from '@/lib/actions';
import { createDraftAction, updateDraftAction } from '../actions';

/**
 * Dasselbe Formular legt an und bessert aus. Ohne `draft` entsteht ein neuer
 * Entwurf; mit `draft` wird der vorhandene geändert — die Dokumentart bleibt
 * dabei stehen, weil an ihr Nummernkreis und Aufbewahrung hängen.
 */
export function DraftForm({
  types,
  folders,
  contacts,
  today,
  defaultTypeKey,
  draft,
}: {
  types: { key: string; label: string }[];
  folders: string[];
  contacts: { id: string; name: string }[];
  /** Vorbelegung beim Anlegen, aus `deps.clock` der Seite — nicht aus der Uhr des Browsers. */
  today: string;
  /** Die eingestellte Vorgabeart für den Ausgang, keine Konstante im Code. */
  defaultTypeKey: string;
  draft?: { id: string; subject: string; body: string; typeKey: string; documentDate: string; folder: string | null; recipientId: string | null };
}) {
  const t = useTranslations('dms');
  const tCommon = useTranslations('common');
  const [state, formAction] = useActionState(
    draft ? updateDraftAction.bind(null, draft.id) : createDraftAction,
    idleState,
  );

  // Kontrolliert, nicht über `defaultValue`: React setzt ein `<form action>`
  // nach dem Lauf der Aktion zurück. Bei einem Fehler stand der Mensch sonst
  // vor leeren Feldern und durfte seinen Text neu tippen.
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [documentDate, setDocumentDate] = useState(draft?.documentDate ?? today);
  const [typeKey, setTypeKey] = useState(draft?.typeKey ?? defaultTypeKey);
  const [folder, setFolder] = useState(draft?.folder ?? '');
  const [recipientId, setRecipientId] = useState(draft?.recipientId ?? '');

  const errors = state.status === 'error' ? state.fieldErrors : {};

  return (
    <form action={formAction} className="space-y-4 rounded-md border border-line bg-surface p-6">
      {state.status === 'error' && Object.keys(errors).length === 0 ? (
        <div role="alert" className="rounded-md bg-error-bg p-3 text-[13px] text-error">{state.message}</div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="subject">{t('fields.subject')}</Label>
        <Input id="subject" name="subject" required value={subject} onChange={(e) => setSubject(e.target.value)} />
        <FieldError id="subject-error" message={errors.subject} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="body">{t('fields.body')}</Label>
        <textarea
          id="body"
          name="body"
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-md border border-line-strong bg-field p-2.5 font-mono text-[13px] text-ink shadow-xs focus:border-ring focus:outline-hidden"
        />
        <FieldError id="body-error" message={errors.body} />
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
            disabled={Boolean(draft)}
            className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs disabled:opacity-60"
          >
            {types.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
          {draft ? <p className="text-[12px] text-muted-ink">{t('typeFixedHint')}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="folder">{t('fields.folder')}</Label>
          <select
            id="folder"
            name="folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
          >
            {/* Nicht „Eingangskorb“: Der liegt im Eingang. Hier heißt kein
                Ordner schlicht, dass noch nicht einsortiert wurde. */}
            <option value="">{t('noFolder')}</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recipientId">{t('fields.recipient')}</Label>
          <select
            id="recipientId"
            name="recipientId"
            value={recipientId}
          onChange={(e) => setRecipientId(e.target.value)}
            className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
          >
            <option value="">{t('fields.noRecipient')}</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <FormActionBar
        back={{ href: draft ? `/dms/${draft.id}` : '/dms', label: draft ? t('backToDocument') : tCommon('backToList') }}
        saveLabel={draft ? t('saveChanges') : t('saveDraft')}
      />
    </form>
  );
}
