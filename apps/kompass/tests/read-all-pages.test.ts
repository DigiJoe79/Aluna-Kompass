import { forbidden, ok } from '@kompass/core';
import { describe, expect, it, vi } from 'vitest';
import { readAllPages } from '@/lib/read-all-pages';

/** Keine stille Grenze (MUSTER § L): Wer eine Auswahl aus allen Posten braucht, liest seitenweise bis `total`. */
describe('readAllPages', () => {
  const source = (n: number) => vi.fn(async ({ limit, offset }: { limit: number; offset: number }) => ok({ items: Array.from({ length: n }, (_, i) => i).slice(offset, offset + limit), total: n }));

  it('liest über die Seitengrenze von 200 hinaus alles', async () => {
    const fetch = source(450);
    const result = await readAllPages(fetch, (v) => v.items);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.value).toHaveLength(450);
    expect(fetch.mock.calls.map(([page]) => page)).toEqual([
      { limit: 200, offset: 0 },
      { limit: 200, offset: 200 },
      { limit: 200, offset: 400 },
    ]);
  });

  it('eine leere Quelle braucht einen Aufruf', async () => {
    const fetch = source(0);
    const result = await readAllPages(fetch, (v) => v.items);
    expect(result.ok && result.value).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reicht eine Ablehnung durch', async () => {
    const result = await readAllPages(async () => forbidden('finance.read'), (v: { items: number[]; total: number }) => v.items);
    expect(result).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});
