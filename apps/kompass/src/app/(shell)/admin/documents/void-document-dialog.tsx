'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { Input } from '@/components/ui/input';
import { voidDocumentAction } from './actions';

export function VoidDocumentDialog({ id, number, open, onOpenChange }: { id: string; number: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('documents.void');
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog open={open} onOpenChange={onOpenChange} title={t('title', { number })} description={t('text')} confirmLabel={t('confirm')} destructive action={() => voidDocumentAction(id, reason)}>
      <FormField id="void-reason" label={t('reason')}><Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} required /></FormField>
    </ConfirmDialog>
  );
}
