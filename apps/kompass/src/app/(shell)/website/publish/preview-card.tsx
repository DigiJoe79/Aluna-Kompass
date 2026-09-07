'use client';

import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { runPreviewAction } from './actions';
import { ExportFindings } from './export-findings';
import type { PublishDiff } from './diff-card';

export interface PreviewData {
  contentHash: string;
  gaps: { collection: string; id: string; field: string }[];
  violations: { path: string; term: string; excerpt: string }[];
  diff: PublishDiff;
  previewDir: string;
}


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
          <ExportFindings gaps={data.gaps} violations={data.violations} />
        </>
      ) : (
        <p className="text-[13px] text-muted-ink">
          Baut die vollständige Webseite als statische Vorschau und vergleicht den Stand mit der Live-Version.
        </p>
      )}
    </section>
  );
}
