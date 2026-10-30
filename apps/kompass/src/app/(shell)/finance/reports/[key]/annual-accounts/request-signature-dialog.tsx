'use client';

import type { AnnualAccountsState } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { requestAnnualAccountsSignatureAction } from './actions';

type Representative = AnnualAccountsState['signature']['representatives'][number];

/** Der Tag `days` nach `day` (ISO), ohne Uhrzeit — wie „Fällig am“ im Wiedervorlage-Dialog der Akte. */
const plusDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * „Um Abzeichnung bitten“ (Designer 1g, 037): Wiedervorlage an ein Vorstandsmitglied, das den Verein vertritt — die
 * Auswahl kennt nur sie (Rückmeldung Frage 3), vorbelegt der erste, der nicht man selbst ist. Titel und Bezug stehen
 * fest. Unter der Auswahl sagt ein Hinweis vor dem Speichern, wenn keine Mail ankommt oder die Person kein Konto hat;
 * lehnt der Dienst ab (ohne Konto), bleibt der Dialog offen mit dem Ausweg Scan.
 */
export function RequestSignatureDialog({
  open,
  onOpenChange,
  reportId,
  designation,
  documentNumber,
  representatives,
  meUserId,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: string;
  designation: string;
  documentNumber: string;
  representatives: Representative[];
  meUserId: string;
  today: string;
}) {
  const t = useTranslations('finance.reports.annualAccounts.request');
  const router = useRouter();
  const first = (representatives.find((r) => r.userId !== meUserId) ?? representatives[0])?.contactId ?? '';
  const [contactId, setContactId] = useState(first);
  const [dueAt, setDueAt] = useState(plusDays(today, 7));
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setContactId(first);
    setDueAt(plusDays(today, 7));
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = representatives.find((r) => r.contactId === contactId);
  const hint = chosen && (chosen.mailState === 'noAddress' || chosen.mailState === 'unavailable' || chosen.mailState === 'noAccount') ? t(chosen.mailState, { name: chosen.name }) : null;
  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};

  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => requestAnnualAccountsSignatureAction({ reportId, contactId, dueAt, name: chosen?.name ?? '' }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="annual-accounts-request-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <FormGrid>
              <FormField id="request-assignee" label={t('assignee')} required error={fieldErrors.contactId}>
                <Select id="request-assignee" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                  {representatives.map((r) => (
                    <option key={r.contactId} value={r.contactId}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField id="request-due" label={t('dueAt')} required error={fieldErrors.dueAt} size="s">
                <Input id="request-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </FormField>
            </FormGrid>
            {hint ? (
              <div data-testid="request-mail-hint">
                <Notice level="hint">{hint}</Notice>
              </div>
            ) : null}
            <FormGrid>
              <FixedValue id="request-follow-up" label={t('followUp')} value={t('followUpValue', { year: designation })} reason={t('fixed')} />
              <FixedValue id="request-reference" label={t('reference')} value={t('referenceValue', { number: documentNumber, year: designation })} reason={t('fixed')} />
            </FormGrid>
          </div>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('submit')} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['contactId', 'dueAt'])} />
      </DialogContent>
    </Dialog>
  );
}
