'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { signAnnualAccountsAction } from './actions';

/**
 * „Jahresrechnung {Jahr} abzeichnen“ (Designer 1d, Abnahme 4): Fassung und Stand im Kopf, Name, Amt und Vertretung als
 * feste Werte aus der Rolle Vorstandsmitglied, der Satz der Abzeichnung und was danach im PDF steht. Kein Feld, kein
 * Kästchen — der Knopf sagt das Verb.
 */
export function SignDialog({
  open,
  onOpenChange,
  reportId,
  designation,
  finalizedAt,
  shortHash,
  organization,
  signer,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: string;
  designation: string;
  finalizedAt: string;
  shortHash: string;
  organization: string;
  signer: { name: string; office: string | null };
  today: string;
}) {
  const t = useTranslations('finance.reports.annualAccounts.sign');
  const fmt = useDateFormat();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  useEffect(() => {
    if (open) feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => signAnnualAccountsAction(reportId), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="annual-accounts-sign-dialog">
        <DialogHeader>
          <DialogTitle>{t('title', { year: designation })}</DialogTitle>
          {/* Der Stand ist eine Kennung: mono wie im Festschreiben-Dialog (Designer Runde 7, 245). */}
          <DialogDescription>{t.rich('description', { date: fmt.date(finalizedAt), hash: shortHash, mono: (chunks) => <span className="font-mono">{chunks}</span> })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <FormGrid>
              <FixedValue id="sign-name" label={t('name')} value={signer.name} reason={t('fromRole')} />
              <FixedValue id="sign-office" label={t('office')} value={signer.office} reason={t('fromRole')} />
              <FixedValue id="sign-representation" label={t('representation')} value={t('represents')} reason={t('fromRole')} />
            </FormGrid>
            <p className="text-body text-ink">{t('statement', { year: designation, organization })}</p>
            <Notice level="hint">{t('inPdf', { name: signer.name, office: signer.office ?? '', hasOffice: signer.office ? 'yes' : 'no', date: fmt.date(today) })}</Notice>
          </div>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('submit')} onSave={() => void save()} state={feedback.state} />
      </DialogContent>
    </Dialog>
  );
}
