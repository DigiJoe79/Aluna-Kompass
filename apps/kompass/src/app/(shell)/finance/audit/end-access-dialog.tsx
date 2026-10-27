'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { RefObject } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { endAuditorAccessAction } from './actions';

/**
 * „Zugang von <Name> beenden“ (Board 12h, Nachtrag Prüferzugang): entzieht dem Nutzer die Rolle Kassenprüfer — nur
 * diese. Unumkehrbar über diesen Weg (die Rolle vergibt die Nutzerverwaltung neu), deshalb mit Rückfrage.
 */
export function EndAccessDialog({ open, onOpenChange, auditor, finalFocus }: { open: boolean; onOpenChange: (open: boolean) => void; auditor: { id: string; name: string }; finalFocus?: RefObject<HTMLElement | null> }) {
  const t = useTranslations('finance.audit.endAccess');
  const router = useRouter();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title', { name: auditor.name })}
      description={t('description', { name: auditor.name })}
      confirmLabel={t('confirm')}
      finalFocus={finalFocus}
      action={async () => {
        const result = await endAuditorAccessAction(auditor.id);
        if (result.status === 'success') {
          toast.success(t('done', { name: auditor.name }));
          router.refresh();
        }
        return result;
      }}
    />
  );
}
