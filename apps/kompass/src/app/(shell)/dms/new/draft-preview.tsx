'use client';

import { AlertTriangle, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge } from '@/components/status-badge';
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
  const fmt = useDateFormat();
  const time = savedAt ? fmt.stamp(savedAt) : '';

  return (
    <div data-slot="preview-pane" className="flex min-h-0 flex-1 flex-col bg-surface-2">
      {/* Leiste neutral, der Zustand steht in der Marke (K10 Charge 2, Spec § 3.7.3). */}
      <div data-testid="preview-bar" className="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-line bg-surface px-5">
        {status === 'current' ? (
          <StatusBadge tone="success" icon={Check}>
            {t('previewPane.current', { time })}
          </StatusBadge>
        ) : null}
        {status === 'stale' ? (
          <StatusBadge tone="warning" icon={AlertTriangle}>
            {t('previewPane.stale', { time })}
          </StatusBadge>
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
          <StatusBadge tone="error" icon={AlertTriangle}>
            {t('previewPane.failed')}
          </StatusBadge>
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

      {/* Wiederholen gehört zum Inhalt, nicht in die Leiste (Designer 2026-10-08); eine Ursache liefert der Renderer nicht. */}
      {status === 'error' ? (
        <div className="flex shrink-0 justify-center px-6 pt-6">
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('previewPane.retry')}
          </Button>
        </div>
      ) : null}

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
