import { describe, expect, it } from 'vitest';
import { countResult, DENOMINATIONS_CENTS, sumDenominations } from '@/lib/finance/cash';

describe('sumDenominations', () => {
  it('sums pieces per denomination and ignores empty or negative fields', () => {
    expect(sumDenominations({ 5000: 2, 100: 3 })).toBe(10300);
    expect(sumDenominations({})).toBe(0);
    expect(sumDenominations({ 200: -3, 50: 1 })).toBe(50); // negativ wird ignoriert
    expect(sumDenominations({ 1: 0 })).toBe(0);
  });

  it('lists all denominations from 500 € down to 1 Ct.', () => {
    expect(DENOMINATIONS_CENTS[0]).toBe(50000);
    expect(DENOMINATIONS_CENTS.at(-1)).toBe(1);
    expect(DENOMINATIONS_CENTS).toHaveLength(15);
  });
});

describe('countResult', () => {
  it('names equal, surplus and shortage with the absolute difference', () => {
    expect(countResult(21450, 21450)).toEqual({ kind: 'equal', differenceCents: 0 });
    expect(countResult(21450, 22000)).toEqual({ kind: 'surplus', differenceCents: 550 });
    expect(countResult(21450, 21000)).toEqual({ kind: 'shortage', differenceCents: -450 });
  });
});
