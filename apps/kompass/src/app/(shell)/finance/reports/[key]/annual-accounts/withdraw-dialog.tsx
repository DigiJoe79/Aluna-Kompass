'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { withdrawAnnualAccountsAction } from './actions';

/**
 * „Von der Webseite nehmen“ (Designer 1e): kurze Bestätigung ohne Grund mit derselben Folge wie das Bereitstellen —
 * sichtbar mit dem nächsten Publizieren. Umkehrbar, deshalb nicht rot. War die Fassung nur bereitgestellt, heißt derselbe
 * Vorgang „Bereitstellung zurücknehmen“.
 */
export function WithdrawDialog({ open, onOpenChange, reportId, designation, live }: { open: boolean; onOpenChange: (open: boolean) => void; reportId: string; designation: string; /** Stand sie auf der Webseite? Sonst „Bereitstellung zurücknehmen“ (Abnahme B1, Nachzug 3). */ live: boolean }) {
  const t = useTranslations('finance.reports.annualAccounts');
  const router = useRouter();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={live ? t('withdraw.title') : t('retract.title')}
      description={live ? t('withdraw.description', { year: designation }) : t('retract.description', { year: designation })}
      confirmLabel={live ? t('withdraw.confirm') : t('retract.confirm')}
      action={async () => {
        const result = await withdrawAnnualAccountsAction(reportId);
        if (result.status === 'success') router.refresh();
        return result;
      }}
    />
  );
}
