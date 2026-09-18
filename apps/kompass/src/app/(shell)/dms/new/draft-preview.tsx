'use client';

import { AlertTriangle, Check } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui/button';
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
  href,
  pages,
  savedAt,
  onRetry,
}: {
  status: PreviewStatus;
  /** Das geholte Blatt. Fehlt, solange der Entwurf noch nie gespeichert wurde. */
  src?: string | null;
  /** Der Weg zum PDF für „PDF öffnen“ — ein Verweis führt weiter als ein Blob. */
  href?: string | null;
  pages?: number | null;
  savedAt?: Date | null;
  onRetry?: () => void;
}) {
  const t = useTranslations('dms');
  const format = useFormatter();
  const time = savedAt ? format.dateTime(savedAt, { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div data-slot="preview-pane" className="flex min-h-0 flex-1 flex-col bg-surface-2">
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

        {/*
          Das Blatt in voller Grösse. Ein Verweis, kein Knopf: So trägt die
          mittlere Maustaste, und der Weg dorthin steht in der Statusleiste des
          Browsers, bevor jemand klickt. Der Platz davor bleibt frei — dort
          steht die Seitenzahl, sobald der Renderer sie liefert.
        */}
        {pages && (status === 'current' || status === 'stale') ? (
          <span className="ml-auto text-[12px] text-ink-2">{t('previewPane.pageCount', { count: pages })}</span>
        ) : null}

        {href && (status === 'current' || status === 'stale') ? (
          <a
            href={href}
            target="_blank"
            rel="noopener"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), !pages && 'ml-auto')}
          >
            {t('openPdf')}
          </a>
        ) : null}
        {/* Der leere Zustand erklärt sich auf dem Blatt selbst — zweimal
            dasselbe zu schreiben macht es nicht klarer. */}
      </div>

      <div className="flex min-h-0 flex-1 items-stretch justify-center overflow-auto p-6">
        {src ? (
          <iframe
            key={src}
            src={src}
            title={t('preview')}
            className={cn(
              // Volle Höhe statt einer Seite hoch: Ein mehrseitiges Schreiben
              // ist der Normalfall, und der Betrachter im Rahmen scrollt.
              // Rand und Papierfarbe bringt er selbst mit — ein zweiter
              // weisser Kasten darum wäre Papier auf Papier.
              'h-full w-full max-w-[820px] rounded-xs shadow-md transition-opacity',
              status === 'stale' && 'opacity-72'
            )}
          />
        ) : (
          <div className="flex aspect-[1/1.414] w-full max-w-[452px] self-center items-center justify-center rounded-xs border border-dashed border-line-strong bg-paper/60 p-10 text-center text-[13px] text-muted-ink">
            {t('previewPane.none')}
          </div>
        )}
      </div>
    </div>
  );
}
