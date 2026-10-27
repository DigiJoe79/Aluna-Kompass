'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { handoverDefaultsAction, startHandoverAction, updateHandoverAction } from './handover/actions';

export interface HandoverEdit {
  id: string;
  handoverOn: string;
  from: PickedContact;
  to: PickedContact;
  version: string;
}

/**
 * „Amtsübergabe beginnen“ (Board 13e, Dialog `md`): Übergabetag*, Von* (vorgeschlagen: wer laut Kontaktrolle am Tag
 * Schatzmeister ist, Herkunft grau), An* (mit Schnellanlage). „Beginnen“ führt auf die Seite der Übergabe. Mit `edit`
 * derselbe Dialog als „Angaben ändern …“ der Seite.
 */
export function HandoverStartDialog({
  open,
  onOpenChange,
  today,
  canCreateContact,
  edit = null,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  canCreateContact: boolean;
  edit?: HandoverEdit | null;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations('finance.closing.handover.startDialog');
  const router = useRouter();
  const [day, setDay] = useState(edit?.handoverOn ?? today);
  const [from, setFrom] = useState<PickedContact | null>(edit?.from ?? null);
  const [to, setTo] = useState<PickedContact | null>(edit?.to ?? null);
  const [suggested, setSuggested] = useState(false);
  // Von Hand angefasst: dann schlägt Kompass nichts mehr vor, auch nicht in ein geleertes Feld.
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setDay(edit?.handoverOn ?? today);
    setFrom(edit?.from ?? null);
    setTo(edit?.to ?? null);
    setSuggested(false);
    setTouched(false);
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Vorschlag für „Von“ beim Öffnen und bei geändertem Tag, solange niemand das Feld angefasst hat (nur beim Beginnen).
  useEffect(() => {
    if (!open || edit || touched || !day) return;
    let gone = false;
    void (async () => {
      const found = await handoverDefaultsAction(day).catch(() => ({ from: null }));
      if (gone || !found.from) return;
      setFrom(found.from);
      setSuggested(true);
    })();
    return () => {
      gone = true;
    };
  }, [open, day, edit, touched]);

  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const input = { handoverOn: day, fromContactId: from?.id ?? '', toContactId: to?.id ?? '' };
    const result = await feedback.run(() => (edit ? updateHandoverAction({ id: edit.id, ...input, expectedVersion: edit.version }) : startHandoverAction(input)), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onOpenChange(false);
    if (edit) {
      toast.success(t('saveEdit'));
      router.refresh();
    } else {
      router.push(`/finance/closing/handover/${encodeURIComponent((result.data as { id: string }).id)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" finalFocus={finalFocus} data-testid="handover-start-dialog">
        <DialogHeader>
          <DialogTitle>{edit ? t('editTitle') : t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="handover-day" label={t('date')} required error={fieldErrors.handoverOn} size="s">
              <Input id="handover-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </FormField>
            <FormCell size="m" className="flex flex-col gap-1">
              <ContactPicker id="handover-from" name="fromContactId" label={t('from')} value={from} onChange={(c) => { setFrom(c); setSuggested(false); setTouched(true); }} required kind="person" canCreate={canCreateContact} />
              {suggested ? <p className="text-hint text-muted-ink">{t('fromSuggested')}</p> : null}
            </FormCell>
            <FormCell size="m">
              <ContactPicker id="handover-to" name="toContactId" label={t('to')} value={to} onChange={setTo} required kind="person" canCreate={canCreateContact} />
            </FormCell>
          </FormGrid>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode={edit ? 'run' : 'create'}
          cancel={() => onOpenChange(false)}
          pending={pending}
          saveLabel={edit ? t('saveEdit') : t('save')}
          onSave={() => void save()}
          state={withUnplacedFieldErrors(feedback.state, ['handoverOn'])}
          testId="handover-start-footer"
        />
      </DialogContent>
    </Dialog>
  );
}
