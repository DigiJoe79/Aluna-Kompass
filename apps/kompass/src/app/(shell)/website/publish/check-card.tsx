'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { runCheckAction } from './actions';

type Check = { contentHash: string; gaps: { collection: string; id: string; field: string }[]; violations: { path: string; term: string; excerpt: string }[] };

const linkFor = (collection: string, id: string) => (collection === 'pages' ? `/website/pages/${id}` : collection === 'animals' ? '/animals' : `/website/${collection}`);

export function CheckCard({ onResult }: { onResult?: (check: Check) => void }) {
  const t = useTranslations('website.publish.check');
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
          <section
            aria-label={t('violationsTitle')}
            className={`rounded-md border p-3 text-[13px] ${check.violations.length > 0 ? 'border-error bg-error-bg' : 'border-line bg-surface-2'}`}
          >
            <h4 className="flex items-center gap-2 font-semibold">
              {check.violations.length > 0 ? <AlertTriangle className="size-4 text-error" aria-hidden /> : null}
              {t('violationsTitle')} · {check.violations.length}
            </h4>
            {check.violations.length === 0 ? (
              <p className="text-muted-ink">{t('noViolations')}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {check.violations.map((v, i) => (
                  <li key={i}>
                    <span className="font-mono">{v.path}</span> · <span className="font-semibold text-error">{v.term}</span> ·{' '}
                    <span className="text-ink-2">{v.excerpt}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label={t('gapsTitle')} className="rounded-md border border-line bg-surface-2 p-3 text-[13px]">
            <h4 className="font-semibold">
              {t('gapsTitle')} · {check.gaps.length}
            </h4>
            {check.gaps.length === 0 ? (
              <p className="text-muted-ink">{t('noGaps')}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {check.gaps.map((g, i) => (
                  <li key={i}>
                    <Link href={linkFor(g.collection, g.id)} className="text-link underline">
                      {g.collection} · {g.id}
                    </Link>{' '}
                    · <span className="font-mono">{g.field}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <p className="text-[13px] text-muted-ink">{t('intro')}</p>
      )}
    </section>
  );
}
