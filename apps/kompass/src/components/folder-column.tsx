'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { scrollContainerOf } from '@/lib/scroll-container';

/**
 * Die Ordnerspalte von Akte und Mediathek. Die Seite wächst mit der Liste und
 * scrollt im Arbeitsbereich (`main`); die Spalte bleibt dabei am oberen Rand
 * des Sichtbaren stehen, damit sich auch auf einer langen Liste etwas auf einen
 * Ordner ziehen lässt (Befund 9). Der Versatz oben hebt das Polster von `main` auf (`--shell-pad`),
 * damit sie am Rand klebt. Ihre Höhe ist der sichtbare Teil des
 * Arbeitsbereichs — dafür gibt es keine CSS-Größe, sie wird gemessen. Ist sie
 * höher als der Platz, scrollt sie selbst.
 */
export function FolderColumn({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = scrollContainerOf(el);
    const hull = el.parentElement!;
    const fit = () => {
      const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      // Die Spalte beginnt unter dem Seitenkopf (Ruhelage) oder am oberen Rand des Sichtbaren (festgehalten).
      // `clientTop`: Die Linie oben an der Hülle (Artboard 1) gehört nicht zur Spalte.
      const top = Math.max(hull.getBoundingClientRect().top + hull.clientTop, view.top);
      el.style.height = `${Math.max(0, view.bottom - top)}px`;
    };
    // Scroll- und Größenereignisse kommen öfter als Bilder; einmal je Bild genügt.
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        fit();
      });
    };
    fit();
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    if (scroller) observer.observe(scroller);
    observer.observe(hull);
    return () => {
      target.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return (
    <div ref={ref} data-testid="folder-column" className={`sticky top-[calc(var(--shell-pad)*-1)] self-start overflow-y-auto ${className ?? ''}`}>
      {children}
    </div>
  );
}
