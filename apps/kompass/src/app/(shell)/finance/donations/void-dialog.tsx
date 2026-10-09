'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { ConsequenceList } from '@/components/consequence-list';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { voidConfirmationAction } from './actions';

export interface VoidableConfirmation {
  id: string;
  number: string;
  lineCount: number;
  /** Schon ein Versandvermerk da? Dann ist „Bereits versandt?“ vorbelegt. */
  sent: boolean;
}

/**
 * „Bestätigung zurücknehmen“ (C1, F6a Task 7): Grund (Pflicht), „Bereits
 * versandt?“ und die Rückholspur — Original zurück am, Finanzamt informiert
 * am —, dazu, was passiert und was bleibt. Als Formular, damit der
 * Korrigieren-Dialog es als Schritt 1 des Dreischritts einbetten kann.
 */
export function VoidForm({ confirmation, onDone, onCancel }: { confirmation: VoidableConfirmation; onDone: () => void; onCancel: () => void }) {
  const t = useTranslations('finance.donations.void');
  const router = useRouter();
  const [note, setNote] = useState('');
  const [alreadySent, setAlreadySent] = useState(confirmation.sent);
  const [originalReturnedOn, setOriginalReturnedOn] = useState('');
  const [taxOfficeInformedOn, setTaxOfficeInformedOn] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const id = `void-${confirmation.id}`;

  const submit = async () => {
    setPending(true);
    const result = await feedback.run(
      () =>
        voidConfirmationAction({
          id: confirmation.id,
          note,
          alreadySent,
          originalReturnedOn: alreadySent && originalReturnedOn ? originalReturnedOn : undefined,
          taxOfficeInformedOn: alreadySent && taxOfficeInformedOn ? taxOfficeInformedOn : undefined,
        }),
      { retry: () => void submit() },
    );
    setPending(false);
    if (result.status === 'success') {
      onDone();
      router.refresh();
    }
  };

  return (
    <div className="space-y-4" data-testid="void-form">
      <FormGrid>
        <FormField id={`${id}-note`} label={t('reason')} required size="l">
          <Textarea id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} required />
        </FormField>
        {/* Befund E: mit Versandvermerk steht der Haken fest — Kompass kennt den eigenen Vermerk. */}
        <FormField id={`${id}-sent`} label={t('alreadySent')} toggle hint={confirmation.sent ? t('alreadySentFixed') : undefined}>
          <Checkbox id={`${id}-sent`} checked={alreadySent} disabled={confirmation.sent} onCheckedChange={(next) => setAlreadySent(next === true)} />
        </FormField>
      </FormGrid>
      {alreadySent ? (
        <section className="border-t border-line pt-5">
          <h3 className="text-[15px] font-semibold">{t('trailTitle')}</h3>
          <p className="mt-1 text-[13px] text-ink-2">{t('trailHint')}</p>
          <div className="mt-3">
            <FormGrid>
              <FormField id={`${id}-returned`} label={t('originalReturnedOn')} size="s">
                <Input id={`${id}-returned`} type="date" value={originalReturnedOn} onChange={(e) => setOriginalReturnedOn(e.target.value)} />
              </FormField>
              <FormField id={`${id}-informed`} label={t('taxOfficeInformedOn')} size="s">
                <Input id={`${id}-informed`} type="date" value={taxOfficeInformedOn} onChange={(e) => setTaxOfficeInformedOn(e.target.value)} />
              </FormField>
            </FormGrid>
          </div>
        </section>
      ) : null}
      <ConsequenceList items={[{ number: confirmation.lineCount, label: t('consequences.lines', { count: confirmation.lineCount }) }]} stays={[t('stays.copy'), t('stays.number', { number: confirmation.number })]} />
      <FormActionBar placement="dialog" cancel={onCancel} destructive pending={pending} saveDisabled={note.trim().length === 0} saveLabel={t('submit')} onSave={() => void submit()} state={feedback.state} />
    </div>
  );
}

export function VoidDialog({ open, onOpenChange, confirmation }: { open: boolean; onOpenChange: (open: boolean) => void; confirmation: VoidableConfirmation }) {
  const t = useTranslations('finance.donations.void');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="bg-surface shadow-md">
        <DialogTitle>{t('title', { number: confirmation.number })}</DialogTitle>
        <DialogDescription tone="body">{t('description')}</DialogDescription>
        <VoidForm confirmation={confirmation} onDone={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
