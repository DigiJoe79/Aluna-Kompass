'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * Hilfsteil der `PanelNav` (kein eigener Baustein): Auf dem Telefon reichen die Reiter über den Rand,
 * und der gewählte darf nicht dahinter verschwinden. Nach dem Laden wird die Leiste so verschoben, dass
 * der Link mit `aria-current="page"` ganz zu sehen ist. Bewusst über `scrollLeft` und nicht über
 * `scrollIntoView`: das verschiebt auch die ganze Seite (Handoff Konsistenz § 4.1).
 */
export function PanelNavScroll({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = ref.current;
    const current = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!container || !current) return;
    const centred = current.offsetLeft - (container.clientWidth - current.offsetWidth) / 2;
    container.scrollLeft = Math.min(Math.max(centred, 0), container.scrollWidth - container.clientWidth);
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
