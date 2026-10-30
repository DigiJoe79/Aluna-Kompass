'use client';

import type { AnnualAccountsState } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Overline } from '@/components/overline';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { attachSignedAnnualAccountsScanAction } from './actions';

type Representative = AnnualAccountsState['signature']['representatives'][number];

/**
 * „Unterschriebenen Scan ablegen“ (Designer Frage 2): wer, wann, die PDF-Datei. Der Scan bleibt in der Akte; auf die
 * Webseite kommt nur die erzeugte Fassung (J2 Entscheidung 3). Ohne Datei nennt der Dienst das Feld.
 */
export function ScanDialog({ open, onOpenChange, reportId, representatives, today }: { open: boolean; onOpenChange: (open: boolean) => void; reportId: string; representatives: Representative[]; today: string }) {
  const t = useTranslations('finance.reports.annualAccounts.scan');
  const router = useRouter();
  const [contactId, setContactId] = useState(representatives[0]?.contactId ?? '');
  const [signedOn, setSignedOn] = useState(today);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setContactId(representatives[0]?.contactId ?? '');
    setSignedOn(today);
    setFile(null);
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const form = new FormData();
    form.append('reportId', reportId);
    form.append('contactId', contactId);
    form.append('signedOn', signedOn);
    if (file) form.append('file', file);
    const result = await feedback.run(() => attachSignedAnnualAccountsScanAction(form), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="annual-accounts-scan-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <FormGrid>
              <FormField id="scan-signer" label={t('signer')} required error={fieldErrors.contactId}>
                <Select id="scan-signer" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                  {representatives.map((r) => (
                    <option key={r.contactId} value={r.contactId}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField id="scan-signed-on" label={t('signedOn')} required error={fieldErrors.signedOn} size="s">
                <Input id="scan-signed-on" type="date" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} />
              </FormField>
            </FormGrid>
            <div className="flex flex-col gap-2">
              <Overline field>{t('file')}</Overline>
              <ReceiptDrop onFiles={(files) => setFile(files[0] ?? null)} disabled={pending} />
              {file ? <p className="text-hint text-muted-ink">{t('chosen', { name: file.name })}</p> : null}
              <FieldError id="scan-file-error" message={fieldErrors.bytes} />
            </div>
            <Notice level="hint">{t('hint')}</Notice>
          </div>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('submit')} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['contactId', 'signedOn', 'bytes'])} />
      </DialogContent>
    </Dialog>
  );
}
