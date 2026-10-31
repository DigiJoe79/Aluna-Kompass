import { describe, expect, it } from 'vitest';
import { SCROLL_LIMIT, withScroll } from '@/lib/scroll-memory';

describe('withScroll', () => {
  it('merkt den Wert je Verlaufseintrag und ersetzt einen alten', () => {
    expect(withScroll({ a: 10 }, 'a', 20)).toEqual({ a: 20 });
    expect(withScroll({ a: 10 }, 'b', 20)).toEqual({ a: 10, b: 20 });
  });

  it('hält höchstens die letzten Einträge, der zuletzt genutzte bleibt', () => {
    let table: Record<string, number> = {};
    for (let i = 0; i < SCROLL_LIMIT; i++) table = withScroll(table, `k${i}`, i);
    table = withScroll(table, 'k0', 99);
    table = withScroll(table, 'neu', 1);
    expect(Object.keys(table)).toHaveLength(SCROLL_LIMIT);
    expect(table.k0).toBe(99);
    expect(table.k1).toBeUndefined();
  });
});
