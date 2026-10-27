'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { useDateFormat } from '@/components/date-format-provider';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { confirmAccountAction } from './actions';

/**
 * Eine Bestätigung je Konto mit Pflichtbegründung (Dialog `sm`): „Fehlen begründen …“ am Bankkonto (Board 13c, die
 * Begründung kommt ins Prüfpaket unter Kontenabstimmung) und „Bestätigen …“ an der rückgerechneten Kasse (Schritt 2,
 * Board 14a: „Barkasse zum 31.12.2025 bestätigen“, Hilfe „Warum wurde nicht am Stichtag gezählt?“).
 */
export function JustifyDialog({ open, onOpenChange, fiscalYearId, account, kind = 'missingJustified', endsOn }: { open: boolean; onOpenChange: (open: boolean) => void; fiscalYearId: string; account: { accountId: string; name: string }; kind?: 'missingJustified' | 'cashRecomputed'; /** Für `cashRecomputed`: der Stichtag. */ endsOn?: string }) {
  const tj = useTranslations('finance.closing.statements.justifyDialog');
  const tc = useTranslations('finance.closing.cash.confirmDialog');
  const fmt = useDateFormat();
  const end = endsOn ? fmt.date(endsOn) : '';
  const cash = kind === 'cashRecomputed';
  const text = {
    title: cash ? tc('title', { account: account.name, end }) : tj('title', { account: account.name }),
    description: cash ? tc('description', { end }) : tj('description'),
    note: cash ? tc('note') : tj('note'),
    hint: cash ? tc('hint') : undefined,
    save: cash ? tc('save') : tj('save'),
    done: cash ? tc('done', { account: account.name }) : tj('done'),
  };
  const router = useRouter();
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  useEffect(() => {
    if (!open) return;
    setNote('');
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account.accountId]);
  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => confirmAccountAction(fiscalYearId, account.accountId, kind, note), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(text.done);
    onOpenChange(false);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="closing-justify-dialog">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.description}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormField id="closing-justify-note" label={text.note} hint={text.hint} required error={fieldErrors.note} size="full">
            <Textarea id="closing-justify-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </FormField>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} pending={pending} saveLabel={text.save} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['note'])} testId="closing-justify-footer" />
      </DialogContent>
    </Dialog>
  );
}
