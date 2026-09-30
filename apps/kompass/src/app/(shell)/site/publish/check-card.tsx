'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { runCheckAction } from './actions';
import { ExportFindings, type Findings } from './export-findings';

type Check = { contentHash: string } & Findings;


export function CheckCard({ onResult }: { onResult?: (check: Check) => void }) {
  const t = useTranslations('site.publish.check');
  const [check, setCheck] = useState<Check | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-[18px]">{t('title')}</h3>
        <Button
          disabled={pending}
          aria-busy={pending}
          onClick={() =>
            start(async () => {
              const s = await runCheckAction();
              if (s.status === 'error') toast.error(s.message);
              else if (s.status === 'success') {
                setCheck(s.data as Check);
                onResult?.(s.data as Check);
              }
            })
          }
        >
          {pending ? t('running') : t('run')}
        </Button>
      </div>
      {check ? (
        <>
          <p className="font-mono text-[12px] text-muted-ink">{t('hash', { hash: check.contentHash.slice(0, 12) })}</p>
          <ExportFindings gaps={check.gaps} violations={check.violations} stale={check.stale} pendingReview={check.pendingReview} />
        </>
      ) : (
        <p className="text-[13px] text-muted-ink">{t('intro')}</p>
      )}
    </section>
  );
}
