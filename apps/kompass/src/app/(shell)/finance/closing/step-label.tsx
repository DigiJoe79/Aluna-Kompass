'use client';

import type { ClosingStatus, ClosingStepKey } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';

/** Der Name eines Schritts; Schritt 10 heißt nach dem Wiederöffnen „Nachprüfung“ (Board 10c). */
export function useStepLabel(): (key: ClosingStepKey, status?: ClosingStatus) => string {
  const t = useTranslations('finance.closing.steps');
  return (key, status) => {
    if (key === 'auditReport' && status) {
      const f = status.steps.find((s) => s.key === 'auditReport')?.facts;
      if (f?.key === 'auditReport' && f.followUpOpen) return t('auditReport.labelFollowUp');
    }
    return t(`${key}.label`);
  };
}
