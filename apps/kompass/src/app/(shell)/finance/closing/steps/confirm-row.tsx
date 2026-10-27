'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Die Handlung eines bestätigbaren Schritts: „Bestätigen …“ (primär) und daneben, was der Schritt sonst anbietet
 * (`outline`-Links). Ohne Recht steht statt des Knopfs der Satz, wer bestätigen kann (Plan C2, Rechte).
 */
export function ConfirmRow({ canConfirm, confirmable, onConfirm, children, testId = 'closing-confirm' }: { canConfirm: boolean; confirmable: boolean; onConfirm: () => void; children?: ReactNode; testId?: string }) {
  const t = useTranslations('finance.closing');
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2.5">
        {canConfirm && confirmable ? (
          <Button type="button" onClick={onConfirm} data-testid={testId}>
            {t('confirm')}
          </Button>
        ) : null}
        {children}
      </div>
      {!canConfirm && confirmable ? <p className="text-meta text-muted-ink">{t('noRight')}</p> : null}
    </div>
  );
}
