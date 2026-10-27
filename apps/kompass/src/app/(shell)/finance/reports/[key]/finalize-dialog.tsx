'use client';

import type { ReportParams } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { finalizeReportAction } from '../actions';

/**
 * „‹Bericht› ‹Jahr› festschreiben“ (Board 2b, Designer Runde 7, 245): unumkehrbar abgelegt, aber keine Gefahr — der Knopf ist nicht rot; die Folge
 * steht in der Beschreibung. Eine Ablehnung des Dienstes bleibt im Dialog (MUSTER § A).
 */
export function FinalizeDialog({ open, onOpenChange, reportKey, params, shortHash, title }: { open: boolean; onOpenChange: (open: boolean) => void; reportKey: string; params: ReportParams; shortHash: string; /** „Rücklagenspiegel 2025“ — der Dialog nennt den Bericht (Designer Runde 7, 245). */ title: string }) {
  const t = useTranslations('finance.reports.view');
  const router = useRouter();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('confirm.title', { report: title })}
      // Der Stand ist eine Kennung: mono (Designer Runde 7, 245).
      description={t.rich('confirm.description', { hash: shortHash, mono: (chunks) => <span className="font-mono">{chunks}</span> })}
      confirmLabel={t('finalize')}
      action={async () => {
        const result = await finalizeReportAction(reportKey, params);
        if (result.status === 'success') {
          if (result.message) toast.success(result.message);
          router.refresh();
        }
        return result;
      }}
    />
  );
}
