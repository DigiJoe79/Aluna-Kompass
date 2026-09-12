'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { idleState } from '@/lib/actions';
import { createDraftAction, updateDraftAction } from '../actions';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

/**
 * Dasselbe Formular legt an und bessert aus. Ohne `draft` entsteht ein neuer
 * Entwurf; mit `draft` wird der vorhandene geändert — die Dokumentart bleibt
 * dabei stehen, weil an ihr Nummernkreis und Aufbewahrung hängen.
 */
export interface DraftFormProps {
  types: { key: string; label: string }[];
  folders: string[];
  contacts: { id: string; name: string }[];
  /** Vorbelegung beim Anlegen, aus `deps.clock` der Seite — nicht aus der Uhr des Browsers. */
  today: string;
  /** Die eingestellte Vorgabeart für den Ausgang, keine Konstante im Code. */
  defaultTypeKey: string;
  draft?: {
    id: string;
    subject: string;
    body: string;
    typeKey: string;
    documentDate: string;
    folder: string | null;
    recipientId: string | null;
    /** Wann dieser Stand gespeichert wurde — die Vorschau nennt die Uhrzeit. */
    savedAt: string;
  };
  onChangedCount?: (count: number) => void;
  onSaved?: (at: Date) => void;
}

export function DraftForm({
  types,
  folders,
  contacts,
  today,
  defaultTypeKey,
  draft,
  onChangedCount,
  onSaved,
}: DraftFormProps) {
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

  // Nach dem Speichern zählt die Fußleiste ab dem neuen Stand.
  const [saves, setSaves] = useState(0);

  useEffect(() => {
    if (state.status !== 'success') return;
    setSaves((n) => n + 1);
    const at = (state.data as { savedAt?: string } | undefined)?.savedAt;
    onSaved?.(at ? new Date(at) : new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    // Die Karte steht in der Spalte, die Leiste darunter läuft durch: Sie gehört
    // zur Spalte, nicht zum Kasten — sonst klebt sie eingerückt über dessen
    // abgerundeter Unterkante.
    <form action={formAction} className="flex flex-col">
      {/* Gespeichert wird hier, nicht anderswo: Die Vorschau steht daneben. */}
      {draft ? <input type="hidden" name="stay" value="1" /> : null}
      <div data-slot="form-card" className="mx-6 mb-6 space-y-4 rounded-md border border-line bg-surface p-5">
      {state.status === 'error' && Object.keys(errors).length === 0 ? (
        <div role="alert" className="rounded-md bg-error-bg p-3 text-[13px] text-error">{state.message}</div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="subject" required>{t('fields.subject')}</Label>
        <Input id="subject" name="subject" required value={subject} onChange={(e) => setSubject(e.target.value)} />
        <FieldError id="subject-error" message={errors.subject} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="body" required>{t('fields.body')}</Label>
        <Textarea
          id="body"
          name="body"
          required
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="resize-y font-mono text-[13px] leading-relaxed"
        />
        <FieldError id="body-error" message={errors.body} />
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
            disabled={Boolean(draft)}
          >
            {types.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </Select>
          {draft ? <p className="text-[12px] text-muted-ink">{t('typeFixedHint')}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="folder">{t('fields.folder')}</Label>
          <Select
            id="folder"
            name="folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          >
            {/* Nicht „Eingangskorb“: Der liegt im Eingang. Hier heißt kein
                Ordner schlicht, dass noch nicht einsortiert wurde. */}
            <option value="">{t('noFolder')}</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recipientId">{t('fields.recipient')}</Label>
          <Select
            id="recipientId"
            name="recipientId"
            value={recipientId}
          onChange={(e) => setRecipientId(e.target.value)}
          >
            <option value="">{t('fields.noRecipient')}</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      </div>
      <FormActionBar
        back={{ href: draft ? `/dms/${draft.id}` : '/dms', label: draft ? t('backToDocument') : tCommon('backToList') }}
        saveLabel={draft ? t('saveChanges') : t('saveDraft')}
        saveLabelChanged={draft ? t('draft.saveAndPreview') : undefined}
        baseline={saves}
        onChangedCount={onChangedCount}
      />
    </form>
  );
}
