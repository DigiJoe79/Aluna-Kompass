'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { copyExpenseClaimAction } from './actions';

/**
 * „Neu einreichen“ an einem abgelehnten Antrag (entschieden 25.09.): kopiert
 * ihn als Entwurf mit Verweis und öffnet die Kopie im Formular.
 */
export function CopyClaimButton({ claimId }: { claimId: string }) {
  const t = useTranslations('finance.expenses.detail');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {error ? (
        <Notice level="refuse" title={t('copy')}>
          {error}
        </Notice>
      ) : null}
      <Button
        type="button"
        disabled={busy}
        className="w-full sm:w-auto"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const state = await copyExpenseClaimAction(claimId);
          if (state.status === 'success') {
            router.push(`/finance/expenses/new?id=${(state.data as { id: string }).id}`);
            return;
          }
          setBusy(false);
          if (state.status === 'error') setError(state.message);
        }}
      >
        {t('copy')}
      </Button>
    </div>
  );
}
