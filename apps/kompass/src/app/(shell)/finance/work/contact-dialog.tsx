'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { BlockedState } from '@/components/blocked-state';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { createContactFromTransactionAction } from './actions';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';

/**
 * „Kontakt anlegen“ aus dem Kontoumsatz (F5 Task 8, Annahme 2): Person oder
 * Organisation, vorbelegt aus der Gegenpartei; die IBAN gehört danach zum
 * Kontakt. Die Namensteile einer Person leitet der Dienst ab, wenn die Felder
 * leer bleiben. Ohne `contacts.manage` steht statt der Maske, wer das Recht
 * vergeben kann (Muster Barkasse).
 */
export function ContactDialog({
  open,
  onOpenChange,
  rawTransactionId,
  counterpartyName,
  canCreate,
  grantNames,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rawTransactionId: string;
  counterpartyName: string | null;
  canCreate: boolean;
  grantNames: string[];
  onDone: () => void;
}) {
  const t = useTranslations('finance.work.contact');
  const tCommon = useTranslations('common');
  const [kind, setKind] = useState<'person' | 'organization'>('person');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [name, setName] = useState(counterpartyName ?? '');
  const feedback = useActionFeedback();
  const resetFeedback = feedback.reset;
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setKind('person');
    setFirstName('');
    setLastName('');
    setName(counterpartyName ?? '');
    resetFeedback();
  }, [open, counterpartyName, resetFeedback]);

  const save = () =>
    startTransition(async () => {
      const input =
        kind === 'organization'
          ? { rawTransactionId, kind, name: name.trim() || undefined }
          : { rawTransactionId, kind, firstName: firstName.trim() || undefined, lastName: lastName.trim() || undefined };
      const result = await feedback.run(() => createContactFromTransactionAction(input), { retry: save });
      if (result.status !== 'success') return;
      onOpenChange(false);
      onDone();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="bg-surface shadow-md">
        <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
        {canCreate ? (
          <div className="space-y-3 text-[13px]">
            <p className="text-ink-2">{t('intro')}</p>
            {kind === 'person' && counterpartyName ? <p className="text-ink-2">{t('fromCounterparty', { name: counterpartyName })}</p> : null}
            <FormGrid>
              <FormCell as={RadioGroup} aria-label={t('kind')} value={kind} onValueChange={(value) => setKind(value as 'person' | 'organization')} size="m" className="flex-row gap-4">
                {(['person', 'organization'] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2">
                    <RadioGroupItem value={k} />
                    <span>{t(k)}</span>
                  </label>
                ))}
              </FormCell>
              {kind === 'organization' ? (
                <FormField id="contact-org-name" label={t('name')} required>
                  <Input id="contact-org-name" value={name} onChange={(e) => setName(e.target.value)} />
                </FormField>
              ) : (
                <>
                  <FormField id="contact-first-name" label={t('firstName')}>
                    <Input id="contact-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </FormField>
                  <FormField id="contact-last-name" label={t('lastName')}>
                    <Input id="contact-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </FormField>
                  <FormCell as="p" size="full" className="text-[12px] text-muted-ink">{t('nameHint')}</FormCell>
                </>
              )}
            </FormGrid>
          </div>
        ) : (
          <BlockedState step={t('title')} title={t('blockedTitle')}>
            {grantNames.length > 0 ? t('blockedTextWithNames', { names: grantNames.join(', ') }) : t('blockedText')}
          </BlockedState>
        )}
        {canCreate ? (
          <FormActionBar placement="dialog" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('save')} onSave={save} state={feedback.state} />
        ) : (
          // Ohne Recht gibt es nichts zu speichern: nur „Abbrechen“.
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
