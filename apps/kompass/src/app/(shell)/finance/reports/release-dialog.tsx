'use client';

import type { ReleaseBasis } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { releaseYearAction, uploadAuditReportAction } from './actions';

/**
 * Die sechs Gründe in fester Folge, der schriftliche Prüfbericht zuerst (Designer Runde 2, 11b). Sechs Optionen in
 * einer `RadioGroup` statt der Faustregel „zwei bis vier“: gedeckt durch Runde 2 („`RadioGroup` mit sechs Gründen“,
 * keine neuen Bausteine) — `ChoiceCards` wären für sechs kurze Gründe zu schwer, ein `Select` versteckte die Hinweise.
 */
const BASES: readonly ReleaseBasis[] = ['auditReport', 'noAuditProvided', 'oralReport', 'singleAuditor', 'notAudited', 'other'];
const NOTE_REQUIRED: readonly ReleaseBasis[] = ['notAudited', 'other'];

export interface CurrentRelease {
  basis: ReleaseBasis;
  note: string | null;
  document: PickedDocument | null;
}

/**
 * „<Jahr> freigeben“ (Board 11b, Dialog `md`): ein Dialog für alle Stellen — Kopf von „Berichte“, Detailseite eines
 * Berichts, später Schritt 10 des Jahresabschlusses. Mit „Schriftlicher Prüfbericht“ das Pflichtfeld „Scan“ (aus der
 * Akte oder hochladen), sonst „Begründung“, Pflicht bei zweien. Die Folge ohne Prüfbericht steht als Satz auf grauem
 * Grund (`Notice hint`), nicht als Warnung. „Freigeben“ ist nie gesperrt; der Dienst nennt, was fehlt.
 */
export function ReleaseDialog({
  open,
  onOpenChange,
  year,
  current,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year: { id: string; designation: string };
  /** „Freigabe ändern …“ öffnet mit dem jetzigen Stand. */
  current: CurrentRelease | null;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations('finance.reports.release');
  const router = useRouter();
  const [basis, setBasis] = useState<ReleaseBasis | ''>(current?.basis ?? '');
  const [note, setNote] = useState(current?.note ?? '');
  const [document, setDocument] = useState<PickedDocument | null>(current?.document ?? null);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const feedback = useActionFeedback();
  const upload = useActionFeedback();

  // Jedes Öffnen beginnt beim jetzigen Stand, nicht bei einer verworfenen Eingabe.
  useEffect(() => {
    if (!open) return;
    setBasis(current?.basis ?? '');
    setNote(current?.note ?? '');
    setDocument(current?.document ?? null);
    feedback.reset();
    upload.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const withAuditReport = basis === 'auditReport';

  const uploadScan = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('fiscalYearId', year.id);
    formData.append('file', file);
    const result = await upload.run(() => uploadAuditReportAction(formData), { retry: () => void uploadScan(files) });
    setUploading(false);
    if (result.status !== 'success') return;
    const filed = result.data as { documentId: string; documentNumber: string; subject: string };
    setDocument({ id: filed.documentId, number: filed.documentNumber, subject: filed.subject, phase: 'issued' });
  };

  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => releaseYearAction(year.id, basis as ReleaseBasis, withAuditReport ? '' : note, withAuditReport ? (document?.id ?? null) : null), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(t('done', { year: year.designation }));
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" finalFocus={finalFocus} data-testid="release-dialog">
        <DialogHeader>
          <DialogTitle>{t('title', { year: year.designation })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <div>
              <Label id="release-basis-label" required>
                {t('basis')}
              </Label>
              <RadioGroup aria-labelledby="release-basis-label" aria-required value={basis} onValueChange={(v) => setBasis(v as ReleaseBasis)} className="mt-2 gap-3">
                {BASES.map((b) => (
                  <label key={b} className="flex cursor-pointer items-start gap-2 text-body text-ink">
                    <RadioGroupItem value={b} className="mt-0.5" />
                    <span className="flex flex-col">
                      {t(`bases.${b}.label`)}
                      {t.has(`bases.${b}.hint`) ? <span className="text-hint text-muted-ink">{t(`bases.${b}.hint`)}</span> : null}
                    </span>
                  </label>
                ))}
              </RadioGroup>
              <FieldError id="release-basis-error" message={fieldErrors.basis} />
            </div>
            {withAuditReport ? (
              <div className="flex flex-col gap-2">
                <DocumentPicker id="release-scan" name="documentId" label={t('scan')} value={document} onChange={setDocument} required />
                {/* Ist ein Dokument gewählt, entfällt die Ablagefläche; ✕ im Feld gibt sie zurück (Designer Runde 8, 348). */}
                {document ? null : <ReceiptDrop onFiles={(files) => void uploadScan(files)} disabled={uploading} />}
                <p className="text-hint text-muted-ink">{document?.number ? t('scanUploaded', { number: document.number }) : t('scanHint')}</p>
                <RefusalNotice state={upload.state} />
                <FieldError id="release-scan-error" message={fieldErrors.documentId} />
              </div>
            ) : (
              <>
                <FormField id="release-note" label={t('note')} hint={t('noteHint')} required={NOTE_REQUIRED.includes(basis as ReleaseBasis)} error={fieldErrors.note} size="full">
                  <Textarea id="release-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
                </FormField>
                <div data-testid="release-consequence">
                  <Notice level="hint">{t('consequence')}</Notice>
                </div>
              </>
            )}
          </div>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode="run"
          cancel={() => onOpenChange(false)}
          pending={pending}
          saveLabel={t('save')}
          onSave={() => void save()}
          state={withUnplacedFieldErrors(feedback.state, ['basis', 'note', 'documentId'])}
          testId="release-footer"
        />
      </DialogContent>
    </Dialog>
  );
}
