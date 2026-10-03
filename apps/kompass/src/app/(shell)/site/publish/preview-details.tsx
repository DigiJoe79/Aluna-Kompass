'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Disclosure } from '@/components/ui/disclosure';
import type { DetailView } from '@/lib/site-job-view';
import { FileList } from './file-list';

/**
 * Dateien und Hinweise der Vorschau, zugeklappt. Listen, die leer sind, tauchen
 * nicht auf; was fehlt, steht in einem Satz („Keine veralteten Verweise, …“),
 * damit nichts Leeres die Seite füllt.
 */
export function PreviewDetails({ detail }: { detail: DetailView }) {
  const t = useTranslations('site.publish.details');
  const tDiff = useTranslations('site.publish.diff');
  const locale = useLocale();
  const language = (code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const diff = detail.diff;
  const gaps = detail.gaps;
  const stale = detail.stale;
  const pending = detail.pendingReview;
  const skipped = detail.skippedImages;
  const empty = {
    gaps: !gaps || gaps.total === 0,
    stale: !stale || stale.total === 0,
    pendingReview: !pending || pending.total === 0,
    skippedImages: !skipped || skipped.total === 0,
  };
  const clear = (['gaps', 'stale', 'pendingReview', 'skippedImages'] as const).filter((k) => empty[k]).map((k) => t(`clear.${k}`));
  const clearText = clear.length > 0 ? `${clear.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()) : null;
  const hasChanges = !!diff && (diff.changed.total > 0 || diff.added.total > 0 || diff.removed.total > 0);
  const more = (shown: number, total: number) => (total > shown ? <li className="font-sans text-muted-ink">{tDiff('more', { count: total - shown })}</li> : null);

  return (
    <details className="group rounded-md border border-line bg-surface-2 text-[13px]">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3 font-semibold">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        {t('show')}
      </summary>
      <div className="grid gap-4 px-3 pb-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h4 className="font-heading text-[15px]">{t('changes')}</h4>
          {hasChanges ? (
            <>
              {diff!.added.total > 0 && (
                <Disclosure label={tDiff('added')} count={diff!.added.total} tone="success">
                  <FileList list={diff!.added} />
                </Disclosure>
              )}
              {diff!.changed.total > 0 && (
                <Disclosure label={tDiff('changed')} count={diff!.changed.total} tone="warning">
                  <FileList list={diff!.changed} />
                </Disclosure>
              )}
              {diff!.removed.total > 0 && (
                <Disclosure label={tDiff('removed')} count={diff!.removed.total} tone="error">
                  <FileList list={diff!.removed} />
                </Disclosure>
              )}
            </>
          ) : (
            <p className="text-muted-ink">{tDiff('none')}</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="font-heading text-[15px]">{t('hints')}</h4>
          {gaps && gaps.total > 0 ? (
            <Disclosure label={t('gaps')} count={gaps.total}>
              <ul className="flex flex-col gap-1">
                {gaps.items.map((g, i) => (
                  <li key={i}>
                    <span className="font-mono">{g.path}</span> · {t('gapItem', { language: language(g.locale) })}
                  </li>
                ))}
                {more(gaps.items.length, gaps.total)}
              </ul>
            </Disclosure>
          ) : null}
          {stale && stale.total > 0 ? (
            <Disclosure label={t('stale')} count={stale.total} tone="warning">
              <p className="text-[12px] text-muted-ink">{t('staleHint')}</p>
              <ul className="flex flex-col gap-1">
                {stale.items.map((s, i) => (
                  <li key={i}>
                    <span className="font-mono">{s.path}</span> · <span className="text-ink-2">{s.value}</span>
                  </li>
                ))}
                {more(stale.items.length, stale.total)}
              </ul>
            </Disclosure>
          ) : null}
          {pending && pending.total > 0 ? (
            <Disclosure label={t('pendingReview')} count={pending.total} tone="warning">
              <p className="text-[12px] text-muted-ink">{t('pendingReviewHint')}</p>
              <ul className="flex flex-col gap-1">
                {pending.items.map((p) => (
                  <li key={p.href}>
                    <Link href={p.href} className="font-medium text-link underline">
                      {p.label}
                    </Link>
                  </li>
                ))}
                {more(pending.items.length, pending.total)}
              </ul>
            </Disclosure>
          ) : null}
          {skipped && skipped.total > 0 ? (
            <Disclosure label={t('skippedImages')} count={skipped.total} tone="warning">
              <FileList list={skipped} />
            </Disclosure>
          ) : null}
          {clearText ? <p className="text-muted-ink">{clearText}</p> : null}
        </div>
      </div>
    </details>
  );
}
