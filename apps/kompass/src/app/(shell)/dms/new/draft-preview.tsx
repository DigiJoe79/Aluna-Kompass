'use client';

import { AlertTriangle, Check } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type PreviewStatus = 'none' | 'current' | 'stale' | 'rendering' | 'error';

/**
 * Das Papier, auf dem der Entwurf landet. Gezeigt wird immer der **gespeicherte**
 * Stand — beim Tippen mitzurendern hiesse, dem Menschen ein Blatt zu zeigen, das
 * es so nirgends gibt. Stattdessen sagt der Kopf, wie alt das Blatt ist.
 */
export function DraftPreview({
  status,
  src,
  savedAt,
  onLoaded,
  onFailed,
  onRetry,
}: {
  status: PreviewStatus;
  /** Fehlt, solange der Entwurf noch nie gespeichert wurde. */
  src?: string | null;
  savedAt?: Date | null;
  onLoaded?: () => void;
  onFailed?: () => void;
  onRetry?: () => void;
}) {
  const t = useTranslations('dms');
  const format = useFormatter();
  const time = savedAt ? format.dateTime(savedAt, { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-2">
      <div
        className={cn(
          'flex h-[46px] shrink-0 items-center gap-2.5 border-b border-line px-5',
          status === 'current' && 'bg-success-bg',
          status === 'stale' && 'bg-warning-bg',
          status === 'error' && 'bg-error-bg'
        )}
      >
        {status === 'current' ? (
          <>
            <Check className="size-4 text-success" aria-hidden />
            <span className="text-[13px] font-semibold text-success">
              {t('previewPane.current', { time })}
            </span>
          </>
        ) : null}
        {status === 'stale' ? (
          <>
            <AlertTriangle className="size-4 text-warning" aria-hidden />
            <span className="text-[13px] font-semibold text-warning">
              {t('previewPane.stale', { time })}
            </span>
          </>
        ) : null}
        {status === 'rendering' ? (
          <>
            <span
              aria-hidden
              className="size-3.5 animate-spin rounded-full border-2 border-line-strong border-t-brand"
            />
            <span className="text-[13px] text-ink-2">{t('previewPane.rendering')}</span>
          </>
        ) : null}
        {status === 'error' ? (
          <>
            <AlertTriangle className="size-4 text-error" aria-hidden />
            <span className="text-[13px] font-semibold text-error">{t('previewPane.failed')}</span>
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={onRetry}>
              {t('previewPane.retry')}
            </Button>
          </>
        ) : null}
        {/* Der leere Zustand erklärt sich auf dem Blatt selbst — zweimal
            dasselbe zu schreiben macht es nicht klarer. */}
      </div>

      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-6">
        {src ? (
          <iframe
            key={src}
            src={src}
            title={t('preview')}
            onLoad={onLoaded}
            onError={onFailed}
            className={cn(
              // Papier ist weiss, auch im Dunkelmodus — es ist ja Papier.
              'aspect-[1/1.414] w-full max-w-[452px] rounded-xs border border-line bg-paper shadow-md transition-opacity',
              status === 'stale' && 'opacity-72'
            )}
          />
        ) : (
          <div className="flex aspect-[1/1.414] w-full max-w-[452px] items-center justify-center rounded-xs border border-dashed border-line-strong bg-paper/60 p-10 text-center text-[13px] text-muted-ink">
            {t('previewPane.none')}
          </div>
        )}
      </div>
    </div>
  );
}
