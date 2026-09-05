'use client';

import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { runPreviewAction } from './actions';
import type { PublishDiff } from './diff-card';

export interface PreviewData {
  contentHash: string;
  gaps: { collection: string; id: string; field: string }[];
  violations: { path: string; term: string; excerpt: string }[];
  diff: PublishDiff;
  previewDir: string;
}

const linkFor = (collection: string, id: string) =>
  collection === 'pages' ? `/website/pages/${id}` : collection === 'animals' ? '/animals' : `/website/${collection}`;

export function PreviewCard({ onResult }: { onResult?: (data: PreviewData) => void }) {
  const t = useTranslations('website.publish');
  const tCheck = useTranslations('website.publish.check');
  const [data, setData] = useState<PreviewData | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-[18px]">Vorschau</h3>
        <div className="flex items-center gap-3">
          {data && (
            <Link
              href="/website/preview-frame"
              className="flex items-center gap-1 text-[13px] font-medium text-link underline"
            >
              {t('preview.open')}
              <ExternalLink className="size-3.5" aria-hidden />
            </Link>
          )}
          <Button
            disabled={pending}
            aria-busy={pending}
            onClick={() =>
              start(async () => {
                const s = await runPreviewAction();
                if (s.status === 'error') {
                  toast.error(s.message);
                } else if (s.status === 'success') {
                  const res = s.data as PreviewData;
                  setData(res);
                  onResult?.(res);
                  toast.success(t('preview.built'));
                }
              })
            }
          >
            {pending ? t('preview.running') : t('preview.run')}
          </Button>
        </div>
      </div>

      {data ? (
        <>
          <p className="font-mono text-[12px] text-muted-ink">{tCheck('hash', { hash: data.contentHash.slice(0, 12) })}</p>
          <section
            aria-label={tCheck('violationsTitle')}
            className={`rounded-md border p-3 text-[13px] ${data.violations.length > 0 ? 'border-error bg-error-bg' : 'border-line bg-surface-2'}`}
          >
            <h4 className="flex items-center gap-2 font-semibold">
              {data.violations.length > 0 ? <AlertTriangle className="size-4 text-error" aria-hidden /> : null}
              {tCheck('violationsTitle')} · {data.violations.length}
            </h4>
            {data.violations.length === 0 ? (
              <p className="text-muted-ink">{tCheck('noViolations')}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {data.violations.map((v, i) => (
                  <li key={i}>
                    <span className="font-mono">{v.path}</span> · <span className="font-semibold text-error">{v.term}</span> ·{' '}
                    <span className="text-ink-2">{v.excerpt}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label={tCheck('gapsTitle')} className="rounded-md border border-line bg-surface-2 p-3 text-[13px]">
            <h4 className="font-semibold">
              {tCheck('gapsTitle')} · {data.gaps.length}
            </h4>
            {data.gaps.length === 0 ? (
              <p className="text-muted-ink">{tCheck('noGaps')}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {data.gaps.map((g, i) => (
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
        <p className="text-[13px] text-muted-ink">
          Baut die vollständige Webseite als statische Vorschau und vergleicht den Stand mit der Live-Version.
        </p>
      )}
    </section>
  );
}
