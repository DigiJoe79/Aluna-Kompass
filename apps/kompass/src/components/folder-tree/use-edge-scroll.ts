'use client';

import { useEffect, type RefObject } from 'react';
import { scrollContainerOf } from '@/lib/scroll-container';

/** Randzone in Pixeln und Höchstgeschwindigkeit in Pixeln je Bild (README § 5). */
const EDGE = 40;
const MAX_STEP = 14;

/**
 * Wie weit je Bild gescrollt wird, wenn der Zeiger bei `y` steht und die
 * sichtbare Fläche von `top` bis `bottom` reicht: negativ am oberen Rand,
 * positiv am unteren, schneller je näher am Rand, dazwischen 0.
 */
export function edgeScrollStep(y: number, top: number, bottom: number): number {
  if (y < top + EDGE) return -Math.ceil(MAX_STEP * (1 - Math.max(0, y - top) / EDGE));
  if (y > bottom - EDGE) return Math.ceil(MAX_STEP * (1 - Math.max(0, bottom - y) / EDGE));
  return 0;
}

/**
 * Randscrollen beim Ziehen mit der Maus — Headless Tree kann es nur für die
 * Tastatur (Spec § 3, Lücke 6). Gehört wird in der Einfangphase, weil die
 * Zeilen `dragover` nicht weiterreichen.
 */
export function useEdgeScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let pointer = 0;
    let scroller: HTMLElement | null = null;

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      scroller = null;
    };
    const tick = () => {
      if (!scroller) return stop();
      const page = scroller === document.scrollingElement || scroller === document.documentElement;
      const box = el.getBoundingClientRect();
      const view = page ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
      // Nur der sichtbare Teil des Baums zählt als Fläche.
      const step = edgeScrollStep(pointer, Math.max(box.top, view.top), Math.min(box.bottom, view.bottom));
      if (step === 0) return stop();
      scroller.scrollTop += step;
      frame = requestAnimationFrame(tick);
    };
    const onOver = (e: DragEvent) => {
      pointer = e.clientY;
      scroller ??= scrollContainerOf(el, { requireOverflow: true }) ?? ((document.scrollingElement as HTMLElement | null) ?? document.documentElement);
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const onLeave = (e: DragEvent) => {
      if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
      stop();
    };

    el.addEventListener('dragover', onOver, true);
    el.addEventListener('dragleave', onLeave, true);
    el.addEventListener('drop', stop, true);
    window.addEventListener('dragend', stop);
    return () => {
      stop();
      el.removeEventListener('dragover', onOver, true);
      el.removeEventListener('dragleave', onLeave, true);
      el.removeEventListener('drop', stop, true);
      window.removeEventListener('dragend', stop);
    };
  }, [ref]);
}
