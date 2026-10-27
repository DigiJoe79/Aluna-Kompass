'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import type { ReceiptListItem } from '@/components/finance/receipt-list';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Overline } from '@/components/overline';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/segmented';
import { StatusBadge } from '@/components/status-badge';
import { Textarea } from '@/components/ui/textarea';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { revokeVoucherAction, uploadCorrectionProofAction } from '../actions';

type Source = 'archive' | 'upload';

/**
 * „Beleg ersetzen …“ im abgeschlossenen Jahr (Designer Runde 6, Frame 15c): Titel mit der Buchungsnummer, der Satz zum
 * Jahr; Block „Bisheriger Beleg“ mit Datei, Nummer und Marke „wird widerrufen“ und darunter der Grund (Pflicht, er
 * begründet den Widerruf); Block „Neuer Beleg“ mit „Aus der Akte“ (`DocumentPicker`) | „Hochladen“ (das Feld aus
 * „Beleg nachreichen“). „Ersetzen“ erst mit Ersatz und Grund. Der Dienst `revokeVoucher` widerruft und verknüpft den
 * Ersatz in einem Zug, zum selben Zeitpunkt.
 *
 * Hochladen: Die Datei geht erst über `uploadCorrectionProofAction` in die Akte — im Namen der Buchung, aber nicht als
 * Beleg verknüpft (sonst hinge sie doppelt) — und dann als `replacementDocumentId` an den Widerruf. Scheitert der
 * Widerruf, liegt sie in der Akte ohne Beleg-Verknüpfung (wie bei „Beleg nachreichen“ ein abgebrochener Vorgang);
 * ein zweiter Versuch mit derselben Datei lädt sie nicht noch einmal hoch.
 */
export function ReplaceVoucherDialog({
  entryId,
  voucher,
  year,
  entryNumber = null,
  canUpload,
  onOpenChange,
}: {
  entryId: string;
  /** Der Beleg, der widerrufen wird; `null` = Dialog zu. */
  voucher: ReceiptListItem | null;
  year: string;
  /** Nummer der Buchung für den Titel (15c). */
  entryNumber?: string | null;
  /** „Hochladen“ legt über die Buchung ab und braucht dasselbe Recht wie „Beleg nachreichen“. */
  canUpload: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('finance.entryView.vouchers');
  const router = useRouter();
  const [source, setSource] = useState<Source>('archive');
  const [picked, setPicked] = useState<PickedDocument | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<{ file: File; documentId: string } | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const open = voucher !== null;

  useEffect(() => {
    if (!open) return;
    setSource('archive');
    setPicked(null);
    setFile(null);
    setUploaded(null);
    setNote('');
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, voucher?.linkId]);

  const chosen = source === 'archive' ? picked !== null : file !== null;

  const replace = async () => {
    if (!voucher) return;
    setPending(true);
    let replacementId = source === 'archive' ? picked?.id : uploaded?.file === file ? uploaded?.documentId : undefined;
    if (source === 'upload' && !replacementId && file) {
      const formData = new FormData();
      formData.append('entryId', entryId);
      formData.append('file', file);
      const up = await feedback.run(() => uploadCorrectionProofAction(formData), { retry: () => void replace() });
      if (up.status !== 'success') return setPending(false);
      replacementId = (up.data as { documentId: string }).documentId;
      setUploaded({ file, documentId: replacementId });
    }
    const result = await feedback.run(() => revokeVoucherAction(voucher.linkId, note, replacementId), { retry: () => void replace() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(t('replace.done'));
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="voucher-replace-dialog">
        <DialogHeader>
          <DialogTitle>{t('replace.title', { number: entryNumber ?? '' })}</DialogTitle>
          <DialogDescription tone="body">{t('replace.description', { year })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {/* Frame 15c: erst der bisherige Beleg mit dem Grund des Widerrufs — der Grund gehört zum Widerruf —, dann der neue. */}
          <div className="flex flex-col gap-5">
            <section aria-labelledby="voucher-replace-old-head" className="flex flex-col gap-2">
              <Overline field as="div">
                <span id="voucher-replace-old-head">{t('replace.previous')}</span>
              </Overline>
              {voucher ? (
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-body text-ink" data-testid="voucher-replace-old">
                  {voucher.title !== voucher.documentNumber ? <span className="break-words">{voucher.title}</span> : null}
                  <span className="font-mono text-hint">{voucher.documentNumber}</span>
                  <StatusBadge tone="warning">{t('replace.revoked')}</StatusBadge>
                </p>
              ) : null}
              <FormField id="voucher-replace-note" label={t('revoke.noteLabel')} required>
                <Textarea id="voucher-replace-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              </FormField>
            </section>
            <section aria-label={t('replace.next')} className="flex flex-col gap-2">
              {canUpload ? (
                <FormField id="voucher-replace-source" label={t('replace.next')} required>
                  <Segmented
                    className="self-start"
                    aria-label={t('replace.next')}
                    value={source}
                    onValueChange={setSource}
                    options={[
                      { value: 'archive', label: t('replace.fromArchive') },
                      { value: 'upload', label: t('replace.upload') },
                    ]}
                  />
                </FormField>
              ) : null}
              {source === 'archive' ? (
                <DocumentPicker id="voucher-replace-document" name="replacementDocumentId" label={canUpload ? t('replace.pick') : t('replace.next')} value={picked} onChange={setPicked} required={!canUpload} />
              ) : (
                <div className="flex flex-col gap-2">
                  <ReceiptDrop onFiles={(files) => setFile(files[0] ?? null)} disabled={pending} />
                  {file ? <p className="text-hint text-muted-ink">{t('replace.chosen', { name: file.name })}</p> : null}
                </div>
              )}
            </section>
          </div>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode="run"
          cancel={() => onOpenChange(false)}
          pending={pending}
          saveLabel={t('replace.confirm')}
          onSave={() => void replace()}
          saveDisabled={!chosen || note.trim().length === 0}
          state={withUnplacedFieldErrors(feedback.state, [])}
          testId="voucher-replace-footer"
          saveTestId="voucher-replace-confirm"
        />
      </DialogContent>
    </Dialog>
  );
}
