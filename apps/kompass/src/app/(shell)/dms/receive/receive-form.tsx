'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { idleState } from '@/lib/actions';
import { receiveDocumentAction, suggestClassificationAction } from '../actions';
import { FileDropzone } from './file-dropzone';
import { NumberHint } from './number-hint';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { DocumentPicker } from '../document-picker';
import { lastOutgoingToAction } from '../search-action';
import type { PickedDocument } from '../search-action';
import { SuggestionFlag } from './suggestion-flag';

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
  skipped = 0,
  queued,
  onFiled,
  onCancel,
}: {
  types: { key: string; label: string }[];
  folders: string[];
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
  /** Wie viele mitgezogene Dateien keine PDFs waren. */
  skipped?: number;
  /** Es warten weitere Dateien: nach dem Ablegen geht es hier weiter. */
  queued?: boolean;
  onFiled?: () => void;
  /** Gesetzt, wenn das Formular in einem Dialog steht. */
  onCancel?: () => void;
}) {
  const t = useTranslations('dms');
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
    setOrigin((prev) => ({ ...prev, ...next }));
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
    if (state.status === 'success') onFiled?.();
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
    <form action={formAction} className="flex min-h-0 flex-col">
      {queued ? <input type="hidden" name="queued" value="1" /> : null}
      {/* Der Körper scrollt, die Fußleiste bleibt stehen. */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {state.status === 'error' && Object.keys(errors).length === 0 ? (
          <div role="alert" className="rounded-md bg-error-bg p-3 text-[13px] text-error">{state.message}</div>
        ) : null}

        {skipped > 0 ? (
          <div role="alert" className="rounded-md bg-error-bg p-3 text-[13px] text-error">
            {t('drop.notPdf', { count: skipped })}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="file" required>{t('fields.file')}</Label>
          <FileDropzone id="file" name="file" required initial={droppedFile} onFile={handleFile} />
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
              className={origin.documentDate ? 'border-info font-mono' : 'font-mono'}
              value={documentDate}
              onFocus={() => touch('documentDate')}
              onChange={(e) => {
                touch('documentDate');
                setDocumentDate(e.target.value);
              }}
            />
            <SuggestionFlag text={origin.documentDate} />
            <FieldError id="documentDate-error" message={errors.documentDate} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="typeKey" required>{t('fields.type')}</Label>
            <Select
              id="typeKey"
              name="typeKey"
              required
              className={origin.typeKey ? 'border-info' : undefined}
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
              className={origin.folder ? 'border-info' : undefined}
              value={folder}
              onFocus={() => touch('folder')}
              onChange={(e) => {
                touch('folder');
                setFolder(e.target.value);
              }}
            >
              <option value="">{t('inbox')}</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
            <SuggestionFlag text={origin.folder} />
          </div>

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
        </div>

        <div>
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
        </div>

        {initialAbout ? (
          <div className="space-y-1.5">
            <span className="block text-[13px] font-semibold text-ink-2">{t('fields.about')}</span>
            <p className="text-[13px] text-ink">{initialAbout.label}</p>
            <input type="hidden" name="aboutType" value={initialAbout.entityType} />
            <input type="hidden" name="aboutId" value={initialAbout.entityId} />
            <SuggestionFlag text={t('suggest.fromEntityPage')} />
          </div>
        ) : null}

        {/* Die Nummer ist eine Vorschau: Gezogen wird sie beim Ablegen. */}
        <NumberHint typeKey={typeKey} />
      </div>
      <FormActionBar cancel={onCancel} sticky={false} saveLabel={t('receiveSubmit')} saveDisabled={!hasFile} />
    </form>
  );
}
