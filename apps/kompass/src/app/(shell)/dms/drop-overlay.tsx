'use client';

import { useTranslations } from 'next-intl';

/**
 * Was beim Ziehen über der Liste liegt: ein abgedunkeltes Feld mit einer Karte,
 * die sagt, wie viele Dateien in der Hand liegen und was mit ihnen passiert.
 * Die Ordnerspalte liegt darüber und bleibt hell — sie ist das Ziel.
 */
export function DropOverlay({ count }: { count: number }) {
  const t = useTranslations('dms');
  return (
    <div className="absolute inset-0 z-2 flex items-center justify-center rounded-md bg-overlay">
      <div className="max-w-[340px] rounded-lg border border-line bg-surface px-7 py-5.5 text-center shadow-md">
        <div className="mb-3.5 flex items-end justify-center gap-2.5" aria-hidden>
          {[-6, 0, 6].map((angle) => (
            <span
              key={angle}
              style={{ transform: `rotate(${angle}deg)` }}
              className="flex h-11 w-8.5 items-end justify-center rounded-[3px] border border-line-strong bg-surface-2 pb-1 font-mono text-[9px] text-muted-ink"
            >
              PDF
            </span>
          ))}
        </div>
        <p className="text-[15px] font-bold text-ink">{t('drop.overlayTitle', { count })}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{t('drop.overlayHint')}</p>
      </div>
    </div>
  );
}
