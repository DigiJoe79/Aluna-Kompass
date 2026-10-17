'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Hilfsteil der waagerecht scrollenden Reiter (`PanelNav`, `ViewTabs`; kein eigener Baustein): Auf dem Telefon reichen
 * die Reiter über den Rand.
 *
 * - Der gewählte darf nicht dahinter verschwinden: Nach dem Laden wird die Leiste so verschoben, dass der Link mit
 *   `aria-current="page"` ganz zu sehen ist. Bewusst über `scrollLeft` und nicht über `scrollIntoView`: das verschiebt
 *   auch die ganze Seite (Handoff Konsistenz § 4.1).
 * - Verlauf am Rand, auf dem der Inhalt weitergeht (Designer Runde 4, Frage 5; 064): `data-fade` nennt `start` und/oder
 *   `end`, das Bild steht in `globals.css`. Gemessen statt über eine Scroll-Zeitleiste — die kennt nicht jeder Browser,
 *   und Aufnahmen mit angehaltenen Animationen zeigten deren Endzustand ohne Verlauf.
 */
export function PanelNavScroll({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<string | undefined>(undefined);
  useLayoutEffect(() => {
    const container = ref.current;
    const current = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!container || !current) return;
    const centred = current.offsetLeft - (container.clientWidth - current.offsetWidth) / 2;
    container.scrollLeft = Math.min(Math.max(centred, 0), container.scrollWidth - container.clientWidth);
  }, []);
  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const update = () => {
      const rest = strip.scrollWidth - strip.clientWidth - strip.scrollLeft;
      const sides = [strip.scrollLeft > 1 ? 'start' : null, rest > 1 ? 'end' : null].filter(Boolean).join(' ');
      setFade(sides || undefined);
    };
    update();
    strip.addEventListener('scroll', update, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resize?.observe(strip);
    return () => {
      strip.removeEventListener('scroll', update);
      resize?.disconnect();
    };
  }, []);
  return (
    <div ref={ref} data-scroll-strip="" data-fade={fade} className={className}>
      {children}
    </div>
  );
}
