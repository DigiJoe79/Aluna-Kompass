'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { BlockedState } from '@/components/blocked-state';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionState } from '@/lib/actions';
import { createContactFromTransactionAction } from './actions';

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
  const [refusal, setRefusal] = useState<Extract<ActionState, { status: 'error' }> | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setKind('person');
    setFirstName('');
    setLastName('');
    setName(counterpartyName ?? '');
    setRefusal(null);
  }, [open, counterpartyName]);

  const save = () =>
    startTransition(async () => {
      const input =
        kind === 'organization'
          ? { rawTransactionId, kind, name: name.trim() || undefined }
          : { rawTransactionId, kind, firstName: firstName.trim() || undefined, lastName: lastName.trim() || undefined };
      const result = await createContactFromTransactionAction(input);
      if (result.status === 'error') {
        setRefusal(result);
        return;
      }
      if (result.status === 'success' && result.message) toast.success(result.message);
      onOpenChange(false);
      onDone();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[480px]">
        <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
        {canCreate ? (
          <div className="space-y-3 text-[13px]">
            <p className="text-ink-2">{t('intro')}</p>
            <div role="radiogroup" aria-label={t('kind')} className="flex gap-4">
              {(['person', 'organization'] as const).map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="radio" name="contact-kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="size-4" />
                  <span>{t(k)}</span>
                </label>
              ))}
            </div>
            {kind === 'organization' ? (
              <div className="space-y-1">
                <Label htmlFor="contact-org-name" required>
                  {t('name')}
                </Label>
                <Input id="contact-org-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            ) : (
              <>
                {counterpartyName ? <p className="text-ink-2">{t('fromCounterparty', { name: counterpartyName })}</p> : null}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="contact-first-name">{t('firstName')}</Label>
                    <Input id="contact-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="contact-last-name">{t('lastName')}</Label>
                    <Input id="contact-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                </div>
                <p className="text-[12px] text-muted-ink">{t('nameHint')}</p>
              </>
            )}
            {refusal ? <Notice level="refuse">{refusal.detail ?? refusal.message}</Notice> : null}
          </div>
        ) : (
          <BlockedState step={t('title')} title={t('blockedTitle')}>
            {grantNames.length > 0 ? t('blockedTextWithNames', { names: grantNames.join(', ') }) : t('blockedText')}
          </BlockedState>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          {canCreate ? (
            <Button type="button" onClick={save} disabled={pending}>
              {t('save')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
