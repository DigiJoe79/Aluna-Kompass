'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { runDeployCheckAction } from './actions';

interface DeployCheck {
  target: string;
  filesAtTarget: string[];
  log: string;
}

export function ConnectionCard({ hasDeploy }: { hasDeploy: boolean }) {
  const t = useTranslations('website.publish.connection');
  const [result, setResult] = useState<DeployCheck | null>(null);
  const [pending, start] = useTransition();

  if (!hasDeploy) return null;

  const isEmpty = result !== null && result.filesAtTarget.length === 0;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading text-[18px]">{t('title')}</h3>
          <p className="text-[13px] text-muted-ink">{result ? t('target', { target: result.target }) : t('intro')}</p>
        </div>
        <Button
          disabled={pending}
          aria-busy={pending}
          onClick={() =>
            start(async () => {
              const s = await runDeployCheckAction();
              if (s.status === 'error') toast.error(s.message);
              else if (s.status === 'success') setResult(s.data as DeployCheck);
            })
          }
        >
          {pending ? t('running') : t('run')}
        </Button>
      </div>

      {result && (
        <section aria-label={t('resultTitle')} className="flex flex-col gap-3">
          <p className={`flex items-start gap-2 text-[13px] ${isEmpty ? 'text-error' : 'text-ink-2'}`}>
            {isEmpty ? <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
            {isEmpty ? t('empty') : t('ok', { count: result.filesAtTarget.length })}
          </p>
          {result.filesAtTarget.length > 0 && (
            <Disclosure label={t('filesTitle')} count={result.filesAtTarget.length} tone="warning">
              <ul className="flex flex-col gap-1 font-mono text-[12px]">
                {result.filesAtTarget.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </Disclosure>
          )}
          <Disclosure label={t('logTitle')}>
            <pre className="font-mono text-[12px] whitespace-pre-wrap text-ink-2">{result.log}</pre>
          </Disclosure>
        </section>
      )}
    </section>
  );
}
