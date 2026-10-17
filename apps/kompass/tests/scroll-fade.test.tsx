// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PanelNavScroll } from '@/components/panel-nav-scroll';
import { ViewTabs } from '@/components/view-tabs';

afterEach(cleanup);

/** jsdom misst nichts: Breiten des Streifens und Lage des aktiven Reiters von Hand. */
function measure(el: HTMLElement, { scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
}

/**
 * Verlauf am Rand, auf dem der Inhalt weitergeht (Designer Runde 4, Frage 5; 064): als Attribut aus der Messung, nicht
 * über eine Scroll-Zeitleiste — die kennt nicht jeder Browser, und Aufnahmen mit angehaltenen Animationen zeigten den
 * Endzustand ohne Verlauf.
 */
describe('Waagerecht scrollende Reiter', () => {
  it('meldet „end“, solange rechts etwas liegt, „start“, sobald links etwas liegt, nichts, wenn alles passt', () => {
    render(<PanelNavScroll className="flex"><a href="/a">A</a></PanelNavScroll>);
    const strip = screen.getByRole('link').parentElement!;
    measure(strip, { scrollWidth: 600, clientWidth: 300 });
    act(() => { strip.scrollLeft = 0; strip.dispatchEvent(new Event('scroll')); });
    expect(strip.getAttribute('data-fade')).toBe('end');
    act(() => { strip.scrollLeft = 150; strip.dispatchEvent(new Event('scroll')); });
    expect(strip.getAttribute('data-fade')).toBe('start end');
    act(() => { strip.scrollLeft = 300; strip.dispatchEvent(new Event('scroll')); });
    expect(strip.getAttribute('data-fade')).toBe('start');
    measure(strip, { scrollWidth: 300, clientWidth: 300 });
    act(() => { strip.scrollLeft = 0; strip.dispatchEvent(new Event('scroll')); });
    expect(strip.hasAttribute('data-fade')).toBe(false);
  });

  it('ViewTabs nutzt denselben Streifen (Verlauf und aktiver Reiter im Blick)', () => {
    render(<ViewTabs label="Ansichten" tabs={[{ key: 'a', label: 'A', href: '/a' }, { key: 'b', label: 'B', href: '/b' }]} current="b" />);
    const strip = screen.getByRole('link', { name: 'B' }).parentElement!;
    expect(strip.hasAttribute('data-scroll-strip')).toBe(true);
  });
});
