import { describe, expect, it } from 'vitest';
import { splitEvenly } from '@/lib/finance/split';

describe('splitEvenly', () => {
  it('puts the remainder cent on the first row; the sum stays exact', () => {
    const parts = splitEvenly(1000, 3);
    expect(parts).toEqual([334, 333, 333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('divides evenly when it divides evenly', () => {
    expect(splitEvenly(900, 3)).toEqual([300, 300, 300]);
  });

  it('gives the whole amount for one row', () => {
    expect(splitEvenly(4850, 1)).toEqual([4850]);
  });

  it('returns an empty list for fewer than one row', () => {
    expect(splitEvenly(1000, 0)).toEqual([]);
    expect(splitEvenly(1000, -2)).toEqual([]);
  });
});
