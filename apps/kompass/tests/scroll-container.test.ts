// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { scrollContainerOf } from '@/lib/scroll-container';

/** jsdom rechnet kein Layout; Höhen werden gesetzt. */
function box(parent: HTMLElement, overflowY: string, size?: { scroll: number; client: number }) {
  const el = document.createElement('div');
  el.style.overflowY = overflowY;
  if (size) {
    Object.defineProperty(el, 'scrollHeight', { value: size.scroll });
    Object.defineProperty(el, 'clientHeight', { value: size.client });
  }
  parent.appendChild(el);
  return el;
}

describe('scrollContainerOf', () => {
  it('nimmt den nächsten Vorfahr mit overflow auto oder scroll, auch wenn er nicht überläuft', () => {
    const outer = box(document.body, 'scroll', { scroll: 900, client: 300 });
    const inner = box(outer, 'auto', { scroll: 100, client: 100 });
    const leaf = box(inner, 'visible');
    expect(scrollContainerOf(leaf)).toBe(inner);
  });

  it('überspringt mit requireOverflow, was nicht überläuft', () => {
    const outer = box(document.body, 'auto', { scroll: 900, client: 300 });
    const inner = box(outer, 'auto', { scroll: 100, client: 100 });
    const leaf = box(inner, 'visible');
    expect(scrollContainerOf(leaf, { requireOverflow: true })).toBe(outer);
  });

  it('übergeht hidden und visible und gibt null zurück, wenn die Seite scrollt', () => {
    const outer = box(document.body, 'hidden', { scroll: 900, client: 300 });
    const leaf = box(box(outer, 'visible'), 'visible');
    expect(scrollContainerOf(leaf)).toBeNull();
    expect(scrollContainerOf(leaf, { requireOverflow: true })).toBeNull();
  });

  it('beginnt bei den Eltern, nicht beim Element selbst', () => {
    const self = box(document.body, 'auto', { scroll: 900, client: 300 });
    expect(scrollContainerOf(self)).toBeNull();
  });
});
