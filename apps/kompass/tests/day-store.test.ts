// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDayStore } from '@/lib/day-store';

const BERLIN = 'Europe/Berlin';

describe('Tages-Store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('meldet genau einmal, wenn der Vereinstag wechselt', () => {
    vi.setSystemTime(new Date('2026-09-12T21:58:00Z')); // 23:58 Berlin
    const store = createDayStore(BERLIN);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.getSnapshot()).toBe('2026-09-12');
    vi.advanceTimersByTime(60_000); // 23:59
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000); // 00:00
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe('2026-09-13');
    vi.advanceTimersByTime(10 * 60_000);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('der UTC-Tageswechsel ist kein Vereinstageswechsel', () => {
    vi.setSystemTime(new Date('2026-09-12T23:58:00Z')); // 01:58 Berlin am 13.
    const store = createDayStore(BERLIN);
    const listener = vi.fn();
    store.subscribe(listener);
    vi.advanceTimersByTime(5 * 60_000); // UTC wechselt auf den 13., Berlin bleibt
    expect(listener).not.toHaveBeenCalled();
  });

  it('Fokus nach langem Schlaf meldet den neuen Tag sofort', () => {
    vi.setSystemTime(new Date('2026-09-12T10:00:00Z'));
    const store = createDayStore(BERLIN);
    const listener = vi.fn();
    store.subscribe(listener);
    vi.setSystemTime(new Date('2026-09-14T10:00:00Z')); // Rechner schlief, kein Takt lief
    window.dispatchEvent(new Event('focus'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe('2026-09-14');
  });

  it('wer nach einer Pause wieder abonniert, bekommt sofort den neuen Tag', () => {
    vi.setSystemTime(new Date('2026-09-12T10:00:00Z'));
    const store = createDayStore(BERLIN);
    store.subscribe(() => {})();
    vi.setSystemTime(new Date('2026-09-14T10:00:00Z')); // ohne Abonnenten lief kein Takt
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.getSnapshot()).toBe('2026-09-14');
  });

  it('ohne Abonnenten läuft kein Takt', () => {
    vi.setSystemTime(new Date('2026-09-12T10:00:00Z'));
    const store = createDayStore(BERLIN);
    const unsubscribe = store.subscribe(() => {});
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });
});
