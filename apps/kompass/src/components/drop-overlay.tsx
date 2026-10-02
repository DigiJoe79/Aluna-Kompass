'use client';

import { useLayoutEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { scrollContainerOf } from '@/lib/scroll-container';

/**
 * Was beim Ziehen von Dateien über der Liste liegt: ein abgedunkeltes Feld mit
 * einer Karte, die sagt, wie viele Dateien in der Hand liegen und was mit
 * ihnen passiert. Die Ordnerspalte liegt darüber und bleibt hell — sie ist das
 * Ziel. Akte und Mediathek teilen sie (README § 3, Artboards 2 und 7b); ohne
 * `title`/`hint` spricht sie die Akte.
 *
 * Das abgedunkelte Feld deckt die ganze Liste ab, die Karte aber steht in der
 * Mitte des **sichtbaren** Teils: Die Seite wächst mit der Liste und scrollt im
 * Arbeitsbereich, eine Karte bei 50 % läge bei einer langen Liste weit unter
 * dem Fenster (Befund 7).
 */
export function DropOverlay({
  count,
  title,
  hint,
  badge = 'PDF',
}: {
  count: number | null;
  /** Statt „3 Dateien ablegen“, etwa „3 Dateien in „Finanzamt“ ablegen“, solange der Zeiger auf einem Ordner steht. */
  title?: string;
  hint?: string;
  /** Die Aufschrift der drei Blätter über dem Titel; `null` lässt sie weg (die Mediathek nimmt mehr als eine Art). */
  badge?: string | null;
}) {
  const t = useTranslations('dms');
  const field = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = field.current;
    const el = card.current;
    if (!root || !el) return;
    // Der Vorfahr, der wirklich scrollt (die Spalte der Liste trägt `overflow-auto`, scrollt aber nicht —
    // es ist der Arbeitsbereich), begrenzt, was zu sehen ist; sonst das Fenster.
    const scroller = scrollContainerOf(root, { requireOverflow: true });
    const place = () => {
      const own = root.getBoundingClientRect();
      const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const top = Math.max(own.top, view.top);
      const bottom = Math.min(own.bottom, view.bottom);
      // Liegt nichts im Bild, bleibt die Karte in der Mitte des Feldes.
      el.style.top = bottom > top ? `${(top + bottom) / 2 - own.top}px` : '50%';
    };
    place();
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      target.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, []);
  return (
    <div ref={field} className="absolute inset-0 z-2 rounded-md bg-overlay">
      <div ref={card} className="absolute left-1/2 top-1/2 w-max max-w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface px-7 py-5.5 text-center shadow-md">
        {badge === null ? null : (
          <div className="mb-3.5 flex items-end justify-center gap-2.5" aria-hidden>
            {[-6, 0, 6].map((angle) => (
              <span
                key={angle}
                style={{ transform: `rotate(${angle}deg)` }}
                className="flex h-11 w-8.5 items-end justify-center rounded-[3px] border border-line-strong bg-surface-2 pb-1 font-mono text-[9px] text-muted-ink"
              >
                {badge}
              </span>
            ))}
          </div>
        )}
        <p className="text-[15px] font-bold text-ink">{title ?? (count === null ? t('drop.overlayTitleUnknown') : t('drop.overlayTitle', { count }))}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{hint ?? t('drop.overlayHint')}</p>
      </div>
    </div>
  );
}
