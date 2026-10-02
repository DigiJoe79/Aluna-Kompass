'use client';

import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { startPreviewAction } from './actions';
import { ExportFindings, type Findings } from './export-findings';
import type { PublishDiff } from './diff-card';
import { useSiteJob } from './use-site-job';

export interface PreviewData extends Findings {
  contentHash: string;
  diff: PublishDiff;
  previewDir: string;
}

/** Der Bau läuft im Hintergrund; der Knopf startet ihn nur, `useSiteJob` wartet auf das Ergebnis. */
export function PreviewCard({ onResult }: { onResult?: (data: PreviewData) => void }) {
  const t = useTranslations('site.publish');
  const tCheck = useTranslations('site.publish.check');
  const [data, setData] = useState<PreviewData | null>(null);
  const { busy, start } = useSiteJob<PreviewData>('preview', {
    onDone: (outcome) => {
      if (outcome.error || !outcome.result) {
        toast.error(outcome.error ?? t('preview.failed'));
        return;
      }
      setData(outcome.result);
      onResult?.(outcome.result);
      toast.success(t('preview.built'));
    },
  });

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-[18px]">{t('previewTitle')}</h3>
        <div className="flex items-center gap-3">
          {data && (
            // Eigener Tab: Prüfergebnis und gebaute Vorschau leben nur im
            // Zustand dieser Seite; wer im selben Tab zurückging, fand beides
            // leer. Das Symbol daneben versprach den neuen Tab schon immer.
            <Link
              href="/site/preview-frame"
              target="_blank"
              rel="noopener"
              className="flex items-center gap-1 text-[13px] font-medium text-link underline"
            >
              {t('preview.open')}
              <ExternalLink className="size-3.5" aria-hidden />
            </Link>
          )}
          <Button
            disabled={busy}
            aria-busy={busy}
            onClick={() => start(startPreviewAction)}
          >
            {busy ? t('preview.running') : t('preview.run')}
          </Button>
        </div>
      </div>

      {data ? (
        <>
          <p className="font-mono text-[12px] text-muted-ink">{tCheck('hash', { hash: data.contentHash.slice(0, 12) })}</p>
          <ExportFindings gaps={data.gaps} violations={data.violations} stale={data.stale} pendingReview={data.pendingReview} />
        </>
      ) : (
        <p className="text-[13px] text-muted-ink">
          {t('previewExplainer')}
        </p>
      )}
    </section>
  );
}
