import { describe, expect, it } from 'vitest';
import { HANDOFF_KEY, stashCsvHandoff, takeCsvHandoff } from '@/lib/finance/csv-handoff';

/** Ein Speicher wie `sessionStorage`, im Speicher — optional mit Kontingent, um das Scheitern zu zeigen. */
function memoryStorage(limit = Infinity): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => {
      if (value.length > limit) throw new Error('QuotaExceededError');
      data.set(key, value);
    },
  };
}

describe('csv handoff (N3, W-1): die Datei vom Zwischenschritt in den Assistenten', () => {
  it('carries name and bytes across, exactly once', () => {
    const storage = memoryStorage();
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x44, 0xe4, 0x00, 0xff, 0x3b]);
    expect(stashCsvHandoff(storage, { name: 'export.csv', bytes })).toBe(true);
    expect(storage.getItem(HANDOFF_KEY)).not.toBeNull();
    expect(takeCsvHandoff(storage)).toEqual({ name: 'export.csv', bytes });
    expect(takeCsvHandoff(storage)).toBeNull();
  });

  it('says so when the storage refuses, and reads nothing from a missing or broken entry', () => {
    expect(stashCsvHandoff(memoryStorage(10), { name: 'gross.csv', bytes: new Uint8Array(100) })).toBe(false);
    expect(stashCsvHandoff(null, { name: 'x.csv', bytes: new Uint8Array(1) })).toBe(false);
    expect(takeCsvHandoff(null)).toBeNull();
    const broken = memoryStorage();
    broken.setItem(HANDOFF_KEY, '{kaputt');
    expect(takeCsvHandoff(broken)).toBeNull();
  });
});
