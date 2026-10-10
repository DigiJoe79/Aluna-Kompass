'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/actions';

/**
 * Ablehnen mit optionalem Grund (Board Vorschläge 6c). Nicht rot: Für Kompass ist nichts verloren, am Hund ändert
 * sich nichts; die Quelle bekommt den Grund zurück.
 */
export function RejectDialog({ open, onOpenChange, sourceName, onReject }: { open: boolean; onOpenChange: (open: boolean) => void; sourceName: string; onReject: (note: string) => Promise<ActionState> }) {
  const t = useTranslations('animals.proposals.reject');
  const [note, setNote] = useState('');
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setNote('');
        onOpenChange(next);
      }}
      role="dialog"
      title={t('title')}
      description={t('description')}
      confirmLabel={t('confirm')}
      action={() => onReject(note.trim())}
    >
      <FormField id="reject-reason" label={t('reason')} hint={t('reasonHint', { source: sourceName })} size="full">
        <Textarea id="reject-reason" value={note} placeholder={t('optional')} rows={3} onChange={(e) => setNote(e.target.value)} />
      </FormField>
    </ConfirmDialog>
  );
}
