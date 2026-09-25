'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConsequenceList } from '@/components/consequence-list';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const id = `void-${confirmation.id}`;

  const submit = async () => {
    setPending(true);
    const result = await voidConfirmationAction({
      id: confirmation.id,
      note,
      alreadySent,
      originalReturnedOn: alreadySent && originalReturnedOn ? originalReturnedOn : undefined,
      taxOfficeInformedOn: alreadySent && taxOfficeInformedOn ? taxOfficeInformedOn : undefined,
    });
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      onDone();
      router.refresh();
    }
  };

  return (
    <div className="space-y-4" data-testid="void-form">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-note`} required>{t('reason')}</Label>
        <textarea id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} required className="w-full rounded-sm border border-line-strong bg-field px-2.5 py-1.5 text-[13px]" />
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={alreadySent} onChange={(e) => setAlreadySent(e.target.checked)} />
        {t('alreadySent')}
      </label>
      {alreadySent ? (
        <div className="space-y-3 rounded-md border border-line bg-surface-2 p-3">
          <p className="text-[13px] text-ink-2">{t('trailHint')}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-returned`}>{t('originalReturnedOn')}</Label>
              <Input id={`${id}-returned`} type="date" value={originalReturnedOn} onChange={(e) => setOriginalReturnedOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-informed`}>{t('taxOfficeInformedOn')}</Label>
              <Input id={`${id}-informed`} type="date" value={taxOfficeInformedOn} onChange={(e) => setTaxOfficeInformedOn(e.target.value)} />
            </div>
          </div>
        </div>
      ) : null}
      <ConsequenceList items={[{ number: confirmation.lineCount, label: t('consequences.lines', { count: confirmation.lineCount }) }]} stays={[t('stays.copy'), t('stays.number', { number: confirmation.number })]} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
        <Button type="button" variant="destructive" disabled={note.trim().length === 0 || pending} onClick={() => void submit()}>{t('submit')}</Button>
      </div>
    </div>
  );
}

export function VoidDialog({ open, onOpenChange, confirmation }: { open: boolean; onOpenChange: (open: boolean) => void; confirmation: VoidableConfirmation }) {
  const t = useTranslations('finance.donations.void');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[560px]">
        <DialogTitle className="font-heading text-[19px]">{t('title', { number: confirmation.number })}</DialogTitle>
        <VoidForm confirmation={confirmation} onDone={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
