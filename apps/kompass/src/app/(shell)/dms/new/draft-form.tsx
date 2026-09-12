'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
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
  /** Darf der Mensch fehlende Kontakte gleich hier anlegen? */
  canCreateContact: boolean;
  /** Textbausteine, die der Editor auf Wunsch einfügt. */
  snippets: { id: string; name: string; subject: string | null; body: string }[];
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
    recipient: PickedContact | null;
    /** Wann dieser Stand gespeichert wurde — die Vorschau nennt die Uhrzeit. */
    savedAt: string;
  };
  onChangedCount?: (count: number) => void;
  onSaved?: (at: Date) => void;
}

export function DraftForm({
  types,
  folders,
  canCreateContact,
  snippets,
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
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Ein Baustein landet an der Schreibmarke, nicht am Ende: Wer mitten im Brief
   * eine Grußformel braucht, will sie dort. Ist der Betreff noch leer und der
   * Baustein bringt einen mit, übernimmt das Formular ihn — aber nie über einen
   * schon getippten hinweg.
   */
  const insertSnippet = (id: string) => {
    const snippet = snippets.find((s) => s.id === id);
    if (!snippet) return;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + snippet.body + body.slice(end));
    if (!subject.trim() && snippet.subject) setSubject(snippet.subject);
    requestAnimationFrame(() => {
      if (!el) return;
      const cursor = start + snippet.body.length;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };
  const [documentDate, setDocumentDate] = useState(draft?.documentDate ?? today);
  const [typeKey, setTypeKey] = useState(draft?.typeKey ?? defaultTypeKey);
  const [folder, setFolder] = useState(draft?.folder ?? '');
  const [recipient, setRecipient] = useState<PickedContact | null>(draft?.recipient ?? null);

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
    <form action={formAction} className="flex h-full flex-col">
      {/* Gespeichert wird hier, nicht anderswo: Die Vorschau steht daneben. */}
      {draft ? <input type="hidden" name="stay" value="1" /> : null}
      {/* Die Karte füllt die Spalte, und die übrige Höhe geht an das Schreibfeld:
          Sonst stünde unter der Karte tote Fläche, während der Ort, an dem der
          Brief entsteht, das kleinste Element der Spalte wäre. */}
      <div className="min-h-0 flex-1 px-6 pb-6">
      <div data-slot="form-card" className="flex h-full flex-col gap-4 rounded-md border border-line bg-surface p-5">
      {state.status === 'error' && Object.keys(errors).length === 0 ? (
        <div role="alert" className="rounded-md bg-error-bg p-3 text-[13px] text-error">{state.message}</div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="subject" required>{t('fields.subject')}</Label>
        <Input id="subject" name="subject" required value={subject} onChange={(e) => setSubject(e.target.value)} />
        <FieldError id="subject-error" message={errors.subject} />
      </div>

      <div className="flex min-h-0 shrink-0 grow flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="body" required>{t('fields.body')}</Label>
          {snippets.length > 0 ? (
            <Select
              aria-label={t('draft.insertSnippet')}
              value=""
              onChange={(e) => {
                if (e.target.value) insertSnippet(e.target.value);
              }}
              className="w-auto"
            >
              <option value="">{t('draft.insertSnippetNone')}</option>
              {snippets.map((snippet) => (
                <option key={snippet.id} value={snippet.id}>
                  {snippet.name}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
        <Textarea
          ref={bodyRef}
          id="body"
          name="body"
          required
          // Neun Zeilen sind das Mindestmass, nicht das Mass: Was die Spalte
          // übrig lässt, bekommt das Feld.
          rows={9}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-describedby="body-hint"
          className="shrink-0 grow resize-none font-mono text-[13px] leading-relaxed"
        />
        <FieldError id="body-error" message={errors.body} />
        {errors.body ? null : <p id="body-hint" className="text-[12px] text-muted-ink">{t('fields.bodyHint')}</p>}
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
        </div>

        {/* Über die ganze Zeile, nicht in der Zelle: In der Zelle streckt der
            Hinweis nur seine Spalte, neben „Datum“ bleibt ein Loch, und die
            vier Felder lesen sich als zwei lose Paare statt als Raster. */}
        {draft ? (
          <p className="text-[12px] text-muted-ink sm:col-span-2">{t('typeFixedHint')}</p>
        ) : null}

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

        <ContactPicker
          id="recipientId"
          name="recipientId"
          label={t('fields.recipient')}
          value={recipient}
          onChange={setRecipient}
          canCreate={canCreateContact}
        />
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
