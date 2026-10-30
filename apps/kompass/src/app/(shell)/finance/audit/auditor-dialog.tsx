'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { ChoiceCards } from '@/components/choice-cards';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { useDateFormat } from '@/components/date-format-provider';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Section } from '@/components/section';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { SuggestionFlag } from '@/app/(shell)/dms/receive/suggestion-flag';
import { previewAuditorAction, saveAuditorAction, uploadConfidentialityAction, type AuditorPreview } from './actions';
import { accessGap } from './auditor-hints';

export interface AuditorDialogValue {
  id: string;
  version: string;
  contact: PickedContact;
  mode: 'kompass' | 'paper';
  confidential: boolean;
  confidentialityDocument: PickedDocument | null;
  electedOn: string | null;
  minutesDocument: PickedDocument | null;
}

/** Ein in Gremien gewählter Kassenprüfer als Vorschlag (`auditorCandidates`), das Protokoll schon aufgelöst. */
export interface AuditorCandidateView {
  contactId: string;
  name: string;
  electedOn: string | null;
  minutesDocument: PickedDocument | null;
  source: { label: string; href: string };
}

type Suggested = { contact: boolean; electedOn: boolean; minutes: boolean };
const NONE: Suggested = { contact: false, electedOn: false, minutes: false };

/**
 * „Prüfer für <Jahr> eintragen“ bzw. „Prüfer bearbeiten“ (Board 12b, Dialog `md`). Die Hinweise zur Unabhängigkeit
 * erscheinen, sobald der Kontakt gewählt ist, als Text unter dem Feld; Zugang und Rolle prüft Kompass bei „in Kompass“
 * sofort und sagt das Ergebnis unter der Auswahl. Die Erklärung lädt man erst am gespeicherten Eintrag hoch — sie hängt
 * am Prüfer.
 *
 * Beim Neuanlegen stehen die in Gremien gewählten Kassenprüfer darüber (G7, Freigabe Joe 2026-10-29): Die Wahl füllt
 * Kontakt, „gewählt am“ und Protokoll; diese tragen das Muster „Vorbelegt aus einem Vorschlag“ (MUSTER § E), bis man sie
 * ändert. Modus und Vertraulichkeit wählt man selbst.
 */
export function AuditorDialog({
  open,
  onOpenChange,
  year,
  auditor,
  canCreateContact,
  candidates = [],
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year: { id: string; designation: string };
  auditor: AuditorDialogValue | null;
  canCreateContact: boolean;
  /** Vorschläge aus Gremien; nur beim Neuanlegen gezeigt. */
  candidates?: readonly AuditorCandidateView[];
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations('finance.audit');
  const fmt = useDateFormat();
  const router = useRouter();
  const [contact, setContact] = useState<PickedContact | null>(auditor?.contact ?? null);
  const [mode, setMode] = useState<'kompass' | 'paper'>(auditor?.mode ?? 'kompass');
  const [confidential, setConfidential] = useState(auditor?.confidential ?? false);
  const [declaration, setDeclaration] = useState<PickedDocument | null>(auditor?.confidentialityDocument ?? null);
  const [electedOn, setElectedOn] = useState(auditor?.electedOn ?? '');
  const [minutes, setMinutes] = useState<PickedDocument | null>(auditor?.minutesDocument ?? null);
  const [preview, setPreview] = useState<AuditorPreview | null>(null);
  const [picked, setPicked] = useState<AuditorCandidateView | null>(null);
  const [suggested, setSuggested] = useState<Suggested>(NONE);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<string | null>(null);
  // Das Hochladen der Erklärung ändert den Eintrag: Danach gilt dessen neue Version (sonst meldete Speichern einen Konflikt).
  const [version, setVersion] = useState(auditor?.version ?? '');
  const feedback = useActionFeedback();
  const upload = useActionFeedback();

  // Jedes Öffnen beginnt beim gespeicherten Stand.
  useEffect(() => {
    if (!open) return;
    setContact(auditor?.contact ?? null);
    setMode(auditor?.mode ?? 'kompass');
    setConfidential(auditor?.confidential ?? false);
    setDeclaration(auditor?.confidentialityDocument ?? null);
    setElectedOn(auditor?.electedOn ?? '');
    setMinutes(auditor?.minutesDocument ?? null);
    setPicked(null);
    setSuggested(NONE);
    setUploaded(null);
    setVersion(auditor?.version ?? '');
    feedback.reset();
    upload.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Hinweise zum gewählten Kontakt, ohne zu speichern.
  const contactId = contact?.id ?? null;
  useEffect(() => {
    if (!open || !contactId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void previewAuditorAction({ fiscalYearId: year.id, contactId, mode }).then((result) => {
      if (!cancelled) setPreview(result.status === 'success' ? (result.data as AuditorPreview) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, contactId, mode, year.id]);

  const pick = (contactId: string) => {
    const candidate = candidates.find((c) => c.contactId === contactId);
    if (!candidate) return;
    setPicked(candidate);
    setContact({ id: candidate.contactId, name: candidate.name });
    setElectedOn(candidate.electedOn ?? '');
    setMinutes(candidate.minutesDocument);
    setSuggested({ contact: true, electedOn: candidate.electedOn !== null, minutes: candidate.minutesDocument !== null });
  };
  const origin = picked ? t('auditorDialog.candidateOrigin', { source: picked.source.label }) : undefined;
  const showCandidates = !auditor && candidates.length > 0;

  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};

  const uploadDeclaration = async (files: File[]) => {
    const file = files[0];
    if (!file || !auditor) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('auditorId', auditor.id);
    formData.append('file', file);
    const result = await upload.run(() => uploadConfidentialityAction(formData), { retry: () => void uploadDeclaration(files) });
    setUploading(false);
    if (result.status !== 'success') return;
    const filed = result.data as { documentId: string; subject: string; version: string };
    setDeclaration({ id: filed.documentId, number: null, subject: filed.subject, phase: 'issued' });
    setUploaded(filed.subject);
    setVersion(filed.version);
    setConfidential(true);
  };

  const save = async () => {
    setPending(true);
    const result = await feedback.run(
      () =>
        saveAuditorAction({
          ...(auditor ? { id: auditor.id, expectedVersion: version } : {}),
          fiscalYearId: year.id,
          contactId: contact?.id ?? '',
          mode,
          confidential,
          confidentialityDocumentId: confidential ? (declaration?.id ?? null) : null,
          electedOn: electedOn || null,
          minutesDocumentId: minutes?.id ?? null,
        }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(auditor ? t('auditorDialog.doneEdit') : t('auditorDialog.doneNew', { name: contact?.name ?? '', year: year.designation }));
    onOpenChange(false);
    router.refresh();
  };

  const gap = preview && mode === 'kompass' ? accessGap(preview.access) : null;
  const board = preview ? (() => {
    const role = preview.independence.boardRole;
    if (!role) return null;
    return role.until ? t('auditors.boardRoleUntil', { year: year.designation, since: fmt.date(role.since), until: fmt.date(role.until) }) : t('auditors.boardRole', { year: year.designation, since: fmt.date(role.since) });
  })() : null;
  const involved = preview?.independence.involvedEntryIds.length ?? 0;
  const independence = [board, involved > 0 ? t('auditorDialog.involvedPreview', { count: involved, year: year.designation }) : null].filter((s): s is string => Boolean(s));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" finalFocus={finalFocus} data-testid="auditor-dialog">
        <DialogHeader>
          <DialogTitle>{auditor ? t('auditorDialog.titleEdit') : t('auditorDialog.titleNew', { year: year.designation })}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            {showCandidates ? (
              <Section title={t('auditorDialog.candidates')}>
                <ChoiceCards
                  mode="choice"
                  name="auditor-candidate"
                  value={picked?.contactId}
                  onSelect={pick}
                  options={candidates.map((c) => ({
                    value: c.contactId,
                    label: c.name,
                    description: c.electedOn ? t('auditorDialog.candidateElected', { date: fmt.date(c.electedOn), source: c.source.label }) : c.source.label,
                  }))}
                />
              </Section>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <ContactPicker
                id="auditor-contact"
                name="contactId"
                label={t('auditorDialog.contact')}
                value={contact}
                onChange={(next) => {
                  setContact(next);
                  setSuggested((s) => ({ ...s, contact: false }));
                  if (picked && next?.id !== picked.contactId) setPicked(null);
                }}
                required
                canCreate={canCreateContact}
                kind="person"
                suggested={suggested.contact}
                hint={suggested.contact ? origin : undefined}
              />
              {independence.length > 0 ? (
                <p className="text-hint text-muted-ink" data-testid="auditor-independence">
                  {independence.join(' ')}
                </p>
              ) : null}
              <FieldError id="auditor-contact-error" message={fieldErrors.contactId} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label id="auditor-mode-label">{t('auditorDialog.mode')}</Label>
              <Segmented
                aria-labelledby="auditor-mode-label"
                value={mode}
                onValueChange={setMode}
                options={[
                  { value: 'kompass', label: t('auditors.mode.kompass') },
                  { value: 'paper', label: t('auditors.mode.paper') },
                ]}
              />
              {preview && mode === 'kompass' ? (
                <div data-testid="auditor-access">
                  {gap ? (
                    <Notice level="warn">{t(`auditors.access.${gap}`)}</Notice>
                  ) : (
                    <p className="text-hint text-muted-ink">{preview.userName ? t('auditorDialog.accessOk', { user: preview.userName }) : t('auditorDialog.accessOkNoName')}</p>
                  )}
                </div>
              ) : null}
            </div>
            <FormGrid>
              <FormField id="auditor-confidential" label={t('auditorDialog.confidential')} size="full" toggle>
                <Checkbox id="auditor-confidential" checked={confidential} onCheckedChange={(checked) => setConfidential(Boolean(checked))} />
              </FormField>
            </FormGrid>
            {confidential ? (
              <div className="flex flex-col gap-2 pl-6">
                <DocumentPicker id="auditor-declaration" name="confidentialityDocumentId" label={t('auditorDialog.declaration')} value={declaration} onChange={setDeclaration} />
                {auditor ? <ReceiptDrop onFiles={(files) => void uploadDeclaration(files)} disabled={uploading} /> : null}
                <p className="text-hint text-muted-ink">{!auditor ? t('auditorDialog.declarationLater') : uploaded ? t('auditorDialog.declarationUploaded', { subject: uploaded }) : t('auditorDialog.declarationHint')}</p>
                <RefusalNotice state={upload.state} />
                <FieldError id="auditor-declaration-error" message={fieldErrors.confidentialityDocumentId} />
              </div>
            ) : null}
            <FormGrid>
              <FormField id="auditor-elected" label={t('auditorDialog.electedOn')} size="s" error={fieldErrors.electedOn} hint={suggested.electedOn ? origin : undefined}>
                <Input
                  id="auditor-elected"
                  type="date"
                  value={electedOn}
                  onChange={(e) => {
                    setElectedOn(e.target.value);
                    setSuggested((s) => ({ ...s, electedOn: false }));
                  }}
                  className={suggested.electedOn ? 'border-agent' : undefined}
                />
              </FormField>
            </FormGrid>
            <div className="flex flex-col gap-1.5">
              <DocumentPicker
                id="auditor-minutes"
                name="minutesDocumentId"
                label={t('auditorDialog.minutes')}
                value={minutes}
                onChange={(next) => {
                  setMinutes(next);
                  setSuggested((s) => ({ ...s, minutes: false }));
                }}
                suggested={suggested.minutes}
              />
              {suggested.minutes ? <SuggestionFlag text={origin} /> : null}
              <FieldError id="auditor-minutes-error" message={fieldErrors.minutesDocumentId} />
            </div>
          </div>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode={auditor ? 'run' : 'create'}
          cancel={() => onOpenChange(false)}
          pending={pending}
          saveLabel={auditor ? t('auditorDialog.saveEdit') : t('auditorDialog.saveNew')}
          onSave={() => void save()}
          state={withUnplacedFieldErrors(feedback.state, ['contactId', 'electedOn', 'confidentialityDocumentId', 'minutesDocumentId'])}
          testId="auditor-footer"
        />
      </DialogContent>
    </Dialog>
  );
}
