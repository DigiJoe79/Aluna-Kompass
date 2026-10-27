'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { closeYearAction } from './actions';

/** Schritt 8: „<Jahr> abschließen“ — eine Rückfrage, nicht `destructive`; Wiederöffnen geht mit Begründung. */
export function CloseYearDialog({ open, onOpenChange, fiscalYearId, year }: { open: boolean; onOpenChange: (open: boolean) => void; fiscalYearId: string; year: string }) {
  const t = useTranslations('finance.closing.close.dialog');
  const router = useRouter();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title', { year })}
      description={t('description', { year })}
      confirmLabel={t('confirm')}
      action={async () => {
        const result = await closeYearAction(fiscalYearId);
        if (result.status === 'success') {
          toast.success(t('done', { year }));
          router.refresh();
        }
        return result;
      }}
    />
  );
}
