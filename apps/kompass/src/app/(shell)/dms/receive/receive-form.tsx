'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ActionForm } from '@/components/forms/action-form';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FolderField } from '@/components/folder-tree/folder-field';
import { Notice } from '@/components/notice';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { idleState } from '@/lib/actions';
import type { FolderEntry } from '@/lib/folder-tree-model';
import { receiveDocumentAction, suggestClassificationAction } from '../actions';
import { FileDropzone } from './file-dropzone';
import { NumberHint } from './number-hint';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { DocumentPicker } from '../document-picker';
import { lastOutgoingToAction } from '../search-action';
import type { PickedDocument } from '../search-action';
import { SuggestionFlag } from './suggestion-flag';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { DialogBody } from '@/components/ui/dialog';

/** Die Felder, die die Einsortierregeln vorbelegen können. */
type Suggested = 'documentDate' | 'typeKey' | 'folder';

export function ReceiveForm({
  types,
  folders,
  canCreateContact,
  initialSender,
  initialAbout,
  defaultTypeKey,
  droppedFile,
  droppedFolder,
  skipped = [],
  queued,
  onFiled,
  onCancel,
}: {
  types: { key: string; label: string }[];
  folders: FolderEntry[];
  /** Darf der Mensch fehlende Kontakte gleich hier anlegen? */
  canCreateContact: boolean;
  /** Von der Kontaktseite vorbelegter Absender. */
  initialSender?: { id: string; name: string } | null;
  /** Von der Seite eines Bezugs vorbelegtes „Betrifft“. */
  initialAbout?: { entityType: string; entityId: string; label: string } | null;
  /** Die eingestellte Vorgabeart für den Eingang, keine Konstante im Code. */
  defaultTypeKey: string;
  /** Aus dem Dateimanager ins Fenster gezogen. */
  droppedFile?: File | null;
  /** Der Ordner, auf dem sie gelandet ist — er schlägt jeden Regelvorschlag. */
  droppedFolder?: string | null;
  /** Die Namen der mitgezogenen Dateien, die keine PDFs waren. */
  skipped?: string[];
  /** Es warten weitere Dateien: nach dem Ablegen geht es hier weiter. */
  queued?: boolean;
  onFiled?: () => void;
  /** Gesetzt, wenn das Formular in einem Dialog steht. */
  onCancel?: () => void;
}) {
  const t = useTranslations('dms');
  const tTree = useTranslations('folderTree');
  const [state, formAction] = useActionState(receiveDocumentAction, idleState);

  const [documentDate, setDocumentDate] = useState('');
  const [subject, setSubject] = useState('');
  const [typeKey, setTypeKey] = useState(defaultTypeKey);
  const [folder, setFolder] = useState(droppedFolder ?? '');
  const [sender, setSender] = useState<PickedContact | null>(initialSender ?? null);
  const senderTouched = useRef(false);
  const senderId = sender?.id ?? '';
  const [repliesTo, setRepliesTo] = useState<PickedDocument | null>(null);
  const repliesToTouched = useRef(false);
  const [hasFile, setHasFile] = useState(!!droppedFile);

  /**
   * Woher ein Feld seinen Wert hat. Steht nur an Feldern, die der Nutzer noch
   * nicht angefasst hat — was er selbst getippt hat, braucht keine Herkunft.
   */
  const [origin, setOrigin] = useState<Partial<Record<Suggested, string>>>(
    droppedFolder ? { folder: t('suggest.fromDrop') } : {}
  );
  // Der Ordner, auf den gezogen wurde, ist eine Entscheidung — kein Vorschlag
  // darf sie überschreiben.
  const touched = useRef(new Set<Suggested>(droppedFolder ? ['folder'] : []));

  const errors = state.status === 'error' ? state.fieldErrors : {};

  /** Ein Feld, das jemand angefasst hat, gehört ihm. */
  const touch = (field: Suggested) => {
    touched.current.add(field);
    setOrigin((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const apply = (
    suggestion: Awaited<ReturnType<typeof suggestClassificationAction>>,
    sender: string,
  ) => {
    if (!suggestion) return;

    // Eine Regel nennt sich beim Namen; ohne Regel stammt der Vorschlag vom
    // letzten Schreiben desselben Absenders.
    const fromRule = suggestion.matchedRuleContains
      ? t(suggestion.matchedRuleField === 'senderName' ? 'suggest.fromRuleSender' : 'suggest.fromRuleFilename', {
          term: suggestion.matchedRuleContains,
        })
      : sender
        ? t('suggest.fromSender')
        : null;

    const next: Partial<Record<Suggested, string>> = {};
    if (suggestion.documentDate && !touched.current.has('documentDate')) {
      setDocumentDate(suggestion.documentDate);
      next.documentDate = t('suggest.fromFilename');
    }
    if (suggestion.typeKey && !touched.current.has('typeKey')) {
      setTypeKey(suggestion.typeKey);
      if (fromRule) next.typeKey = fromRule;
    }
    if (suggestion.folder != null && !touched.current.has('folder')) {
      setFolder(suggestion.folder);
      if (fromRule) next.folder = fromRule;
    }
    // Ohne diese Wache löst eine leere Vorschau (kein Regeltreffer, kein
    // Absender) trotzdem ein `setOrigin` mit einem inhaltsgleichen, aber neuen
    // Objekt aus — React rendert das ganze Formular neu, obwohl sich nichts
    // geändert hat. Kommt diese Antwort spät (Server Action unter Last), fällt
    // der Re-Render mitten in eine laufende Eingabe.
    if (Object.keys(next).length > 0) {
      setOrigin((prev) => ({ ...prev, ...next }));
    }
  };

  const handleFile = async (file: File | null) => {
    setHasFile(!!file);
    if (!file) return;
    apply(await suggestClassificationAction(file.name, senderId || undefined), senderId);
  };

  // Eine gezogene Datei war nie im Dateifeld: Der Vorschlag muss beim Öffnen laufen.
  useEffect(() => {
    if (droppedFile) void handleFile(droppedFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedFile]);

  useEffect(() => {
    if (state.status === 'success') {
      if (state.message) toast.warning(state.message);
      onFiled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const handleSenderChange = async (next: PickedContact | null) => {
    setSender(next);
    // Wer schreibt, antwortet meist auf das, was er zuletzt bekommen hat.
    if (!repliesToTouched.current) {
      setRepliesTo(next ? await lastOutgoingToAction(next.id) : null);
    }
    const file = (document.getElementById('file') as HTMLInputElement | null)?.files?.[0];
    if (!file) return;
    apply(await suggestClassificationAction(file.name, next?.id || undefined), next?.id ?? '');
  };

  return (
    // `ActionForm`: Lehnt der Server ab (etwa weil der Ordner inzwischen anders
    // heißt), bleiben Datei und Eingaben stehen — ein `<form action>` setzte
    // die Datei zurück.
    <ActionForm action={formAction} state={state} className="flex min-h-0 flex-1 flex-col">
      {queued ? <input type="hidden" name="queued" value="1" /> : null}
      {/* Der Körper scrollt, Kopf und Fußleiste bleiben stehen (`layout="fixed-footer"` am Dialog). */}
      <DialogBody>
        {/* Beim Ziehen lässt sich nicht verlässlich prüfen, was ein PDF ist; nach dem Loslassen wird jede Datei genannt (Artboard 2f). */}
        {skipped.length > 0 ? (
          <div className="mb-4">
            <Notice level="warn" reasons={skipped.map((name) => t('drop.skippedNamed', { name }))}>
              {t('drop.skippedNamed', { name: skipped[0]! })}
            </Notice>
          </div>
        ) : null}

        <section>
          <h3 className="text-[15px] font-semibold">{t('sections.document')}</h3>
          <div className="mt-3">
            <FormGrid>
              <FormField id="file" label={t('fields.file')} required error={errors.file} size="full">
                <FileDropzone id="file" name="file" required initial={droppedFile} onFile={handleFile} />
              </FormField>

              <FormField id="typeKey" label={t('fields.type')} required>
                <Select
                  id="typeKey"
                  name="typeKey"
                  required
                  className={origin.typeKey ? 'border-agent' : undefined}
                  value={typeKey}
                  onFocus={() => touch('typeKey')}
                  onChange={(e) => {
                    touch('typeKey');
                    setTypeKey(e.target.value);
                  }}
                >
                  {types.map((type) => (
                    <option key={type.key} value={type.key}>
                      {type.label}
                    </option>
                  ))}
                </Select>
                <SuggestionFlag text={origin.typeKey} />
              </FormField>

              <FormField id="documentDate" label={t('fields.documentDate')} required error={errors.documentDate} size="s">
                <Input
                  id="documentDate"
                  name="documentDate"
                  type="date"
                  required
                  className={origin.documentDate ? 'border-agent font-mono' : 'font-mono'}
                  value={documentDate}
                  onFocus={() => touch('documentDate')}
                  onChange={(e) => {
                    touch('documentDate');
                    setDocumentDate(e.target.value);
                  }}
                />
                <SuggestionFlag text={origin.documentDate} />
              </FormField>

              <FormField id="subject" label={t('fields.subject')} required error={errors.subject} size="l">
                <Input
                  id="subject"
                  name="subject"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </FormField>

              {/* Die Nummer ist eine Vorschau: Gezogen wird sie beim Ablegen. */}
              <FormCell size="full">
                <NumberHint typeKey={typeKey} />
              </FormCell>
            </FormGrid>
          </div>
        </section>

        <section className="mt-5 border-t border-line pt-5">
          <h3 className="text-[15px] font-semibold">{t('sections.filing')}</h3>
          <div className="mt-3">
            <FormGrid>
              {/* Der Absender vor dem Ordner: Sein Wechsel zieht Regelvorschläge (Art, Ordner) und „Antwort auf“ nach. */}
              <FormCell size="m" className="flex flex-col gap-1.5">
                <ContactPicker
                  id="senderId"
                  name="senderId"
                  label={t('fields.sender')}
                  value={sender}
                  onChange={(next) => {
                    senderTouched.current = true;
                    void handleSenderChange(next);
                  }}
                  canCreate={canCreateContact}
                />
                {initialSender && !senderTouched.current ? <SuggestionFlag text={t('suggest.fromContactPage')} /> : null}
              </FormCell>

              <FormCell size="m" className="flex flex-col gap-1.5">
                {/* Der Ort im Baum statt einer langen Liste; das versteckte Feld `folder` trägt den Weg (`''` = Eingangskorb). */}
                <FolderField
                  value={folder || null}
                  folders={folders}
                  label={t('fields.folder')}
                  emptyLabel={t('inbox')}
                  name="folder"
                  moveLabel={tTree('change')}
                  dialogTitle={tTree('pickTitle')}
                  showLocation={false}
                  verb="pick"
                  variant="field"
                  suggested={!!origin.folder}
                  errorId={errors.folder ? 'folder-error' : undefined}
                  onChange={(path) => {
                    touch('folder');
                    setFolder(path ?? '');
                  }}
                />
                <SuggestionFlag text={origin.folder} />
                <FieldError id="folder-error" message={errors.folder} />
              </FormCell>

              <FormCell size="m" className="flex flex-col gap-1.5">
                <DocumentPicker
                  id="repliesToId"
                  name="repliesToId"
                  label={t('fields.repliesTo')}
                  value={repliesTo}
                  onChange={(next) => {
                    repliesToTouched.current = true;
                    setRepliesTo(next);
                  }}
                />
                {repliesTo && !repliesToTouched.current ? <SuggestionFlag text={t('suggest.fromSender')} /> : null}
              </FormCell>

              {initialAbout ? (
                <FormCell size="m" className="flex flex-col gap-1.5">
                  <span className="block text-[13px] font-semibold text-ink-2">{t('fields.about')}</span>
                  <p className="text-[13px] text-ink">{initialAbout.label}</p>
                  <input type="hidden" name="aboutType" value={initialAbout.entityType} />
                  <input type="hidden" name="aboutId" value={initialAbout.entityId} />
                  <SuggestionFlag text={t('suggest.fromEntityPage')} />
                </FormCell>
              ) : null}
            </FormGrid>
          </div>
        </section>
      </DialogBody>
      <FormActionBar mode="create" cancel={onCancel} state={state} saveLabel={t('receiveSubmit')} saveDisabled={!hasFile} />
    </ActionForm>
  );
}
