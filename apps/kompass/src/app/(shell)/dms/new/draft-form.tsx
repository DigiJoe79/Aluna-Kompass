'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { SuggestionFlag } from '../receive/suggestion-flag';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { idleState } from '@/lib/actions';
import { createDraftAction, updateDraftAction } from '../actions';
import { FolderField } from '@/components/folder-tree/folder-field';
import type { FolderEntry } from '@/lib/folder-tree-model';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';

/**
 * Dasselbe Formular legt an und bessert aus. Ohne `draft` entsteht ein neuer
 * Entwurf; mit `draft` wird der vorhandene geändert — die Dokumentart bleibt
 * dabei stehen, weil an ihr Nummernkreis und Aufbewahrung hängen.
 */
export interface DraftFormProps {
  types: { key: string; label: string }[];
  folders: FolderEntry[];
  /** Vorbelegter Ordner, etwa vom geöffneten Ordner der Akte; nur beim Anlegen. */
  initialFolder?: string | null;
  /** Darf der Mensch fehlende Kontakte gleich hier anlegen? */
  canCreateContact: boolean;
  /** Textbausteine, die der Editor auf Wunsch einfügt. */
  snippets: { id: string; name: string; subject: string | null; body: string }[];
  /** Vorbelegter Empfänger, etwa von der Kontaktseite. */
  initialRecipient?: PickedContact | null;
  /** Woher die Vorbelegung kommt — steht am Feld, solange sie unverändert ist. */
  recipientOrigin?: string;
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
  initialFolder,
  canCreateContact,
  snippets,
  initialRecipient,
  recipientOrigin,
  today,
  defaultTypeKey,
  draft,
  onChangedCount,
  onSaved,
}: DraftFormProps) {
  const t = useTranslations('dms');
  const tCommon = useTranslations('common');
  const tTree = useTranslations('folderTree');
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
  const [folder, setFolder] = useState(draft?.folder ?? initialFolder ?? '');
  const [recipient, setRecipient] = useState<PickedContact | null>(draft?.recipient ?? initialRecipient ?? null);
  const recipientTouched = useRef(false);

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
      <FormField id="subject" label={t('fields.subject')} required error={errors.subject}>
        <Input id="subject" name="subject" required value={subject} onChange={(e) => setSubject(e.target.value)} />
      </FormField>

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

      {/* Die Angaben unter einer Trennlinie im `FormGrid`: In der Schreibspalte (innen rund 430 px) zwei Spalten,
          Zeile für Zeile Empfänger · Ordner, dann Art · Datum. Wer schreibt, legt zuerst fest, an wen; Art und
          Datum sind meist vorbelegt (HANDOFF Konsistenz § 8c). */}
      <div className="shrink-0 border-t border-line pt-4">
      <FormGrid>
        <FormCell size="m">
          <ContactPicker
            id="recipientId"
            name="recipientId"
            label={t('fields.recipient')}
            value={recipient}
            onChange={(next) => {
              recipientTouched.current = true;
              setRecipient(next);
            }}
            canCreate={canCreateContact}
          />
          {recipientOrigin && !recipientTouched.current ? <SuggestionFlag text={recipientOrigin} /> : null}
        </FormCell>
        <FormCell size="m" className="space-y-1.5">
          {/* Der Ort im Baum statt einer langen Liste; das versteckte Feld `folder` trägt den Weg (`''` = kein Ordner). */}
          <FolderField
            value={folder || null}
            folders={folders}
            label={t('fields.folder')}
            emptyLabel={t('noFolder')}
            name="folder"
            moveLabel={tTree('change')}
            dialogTitle={tTree('pickTitle')}
            showLocation={false}
            verb="pick"
            variant="field"
            kind="documents"
            onChange={(path) => setFolder(path ?? '')}
            errorId={errors.folder ? 'folder-error' : undefined}
          />
          <FieldError id="folder-error" message={errors.folder} />
        </FormCell>

        <FormField id="typeKey" label={t('fields.type')} required size="m">
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
        </FormField>

        <FormField id="documentDate" label={t('fields.documentDate')} required error={errors.documentDate} size="s">
          <Input
            id="documentDate"
            name="documentDate"
            type="date"
            required
            value={documentDate}
            onChange={(e) => setDocumentDate(e.target.value)}
          />
        </FormField>

        {/* Über die ganze Zeile, nicht in der Zelle: In der Zelle streckt der
            Hinweis nur seine Spalte, neben „Art“ bleibt ein Loch, und die
            vier Felder lesen sich als zwei lose Paare statt als Raster. */}
        {draft ? (
          <FormCell as="p" size="full" className="text-[12px] text-muted-ink">{t('typeFixedHint')}</FormCell>
        ) : null}

      </FormGrid>
      </div>

      </div>
      </div>
      <FormActionBar
        mode={draft ? 'edit' : 'create'}
        state={state}
        back={{ href: draft ? `/dms/${draft.id}` : '/dms', label: draft ? t('backToDocument') : tCommon('backToList') }}
        saveLabel={draft ? t('saveChanges') : t('saveDraft')}
        saveLabelChanged={draft ? t('draft.saveAndPreview') : undefined}
        baseline={saves}
        onChangedCount={onChangedCount}
      />
    </form>
  );
}
