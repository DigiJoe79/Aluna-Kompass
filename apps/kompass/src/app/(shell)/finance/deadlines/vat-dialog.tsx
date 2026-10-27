'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { fileVatFilingDocumentAction, updateVatFilingAction } from '../vat/actions';
import { recordVatFilingAction } from './actions';

/**
 * „Abgabe eintragen …“ (Dialog `sm`): ein Datum zu einem Umsatzsteuer-Zeitraum (`'YYYY'`, `'YYYY-Qn'`, `'YYYY-MM'`);
 * die Frist verschwindet damit. `label` ist der lesbare Zeitraum (Board Umsatzsteuer 5a: „Abgabe eintragen · Q2 2026“,
 * die Jahreserklärung ohne Quartal). Seit E6b (Task 8) mit dem ELSTER-Übertragungsprotokoll (optional, kommt in die
 * Akte) und derselbe Dialog hinter „Bearbeiten …“ der Abgabe-Karte: Mit `filing` ändert er Tag und Protokoll der letzten
 * Abgabe statt eine neue einzutragen (Designer 5a/8a).
 */
export function VatDialog({ open, onOpenChange, period, label, today, filing = null }: { open: boolean; onOpenChange: (open: boolean) => void; period: string; label: string; today: string; filing?: { id: string; filedOn: string } | null }) {
  const t = useTranslations('finance.deadlines.vatDialog');
  const router = useRouter();
  const [filedOn, setFiledOn] = useState(filing?.filedOn ?? today);
  const [protocol, setProtocol] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const upload = useActionFeedback();
  useEffect(() => {
    if (!open) return;
    setFiledOn(filing?.filedOn ?? today);
    setProtocol(null);
    feedback.reset();
    upload.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => (filing ? updateVatFilingAction(filing.id, filedOn) : recordVatFilingAction(period, filedOn)), { retry: () => void save() });
    if (result.status !== 'success') {
      setPending(false);
      return;
    }
    const filingId = filing?.id ?? (result.data as { id?: string } | undefined)?.id;
    if (protocol && filingId) {
      const formData = new FormData();
      formData.append('filingId', filingId);
      formData.append('slot', 'transmissionProtocol');
      formData.append('file', protocol);
      const filed = await upload.run(() => fileVatFilingDocumentAction(formData));
      if (filed.status !== 'success') {
        setPending(false);
        router.refresh();
        return;
      }
    }
    setPending(false);
    toast.success(t('done'));
    onOpenChange(false);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="vat-dialog">
        <DialogHeader>
          <DialogTitle>{filing ? t('titleEdit', { label }) : t('title', { label })}</DialogTitle>
          <DialogDescription>{filing ? t('descriptionEdit') : t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <FormField id="vat-filed-on" label={t('date')} required error={fieldErrors.filedOn} size="s">
              <Input id="vat-filed-on" type="date" value={filedOn} max={today} onChange={(e) => setFiledOn(e.target.value)} />
            </FormField>
            <div className="flex flex-col gap-2">
              <Label>{t('protocol')}</Label>
              <ReceiptDrop onFiles={(files) => setProtocol(files[0] ?? null)} disabled={pending} />
              <p className="text-hint text-muted-ink" data-testid="vat-protocol">
                {protocol ? t('protocolChosen', { name: protocol.name }) : t('protocolHint')}
              </p>
              <RefusalNotice state={upload.state} />
            </div>
          </div>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} pending={pending} saveLabel={filing ? t('saveEdit') : t('save')} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['filedOn'])} testId="vat-footer" />
      </DialogContent>
    </Dialog>
  );
}
