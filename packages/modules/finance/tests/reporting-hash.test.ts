import { describe, expect, it } from 'vitest';
import { canonicalJson, reportHash } from '../src/reporting/hash';

describe('report hash (Spec Rechenschaft § A „Daten-Hash“)', () => {
  it('writes canonical json with sorted keys and kept list order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe('{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}');
  });

  it('hashes the same data the same way, whatever the key order, and differently for another amount', () => {
    const a = reportHash('incomeStatement', { fiscalYearId: 'FY' }, { incomeCents: 100, expenseCents: 50 });
    const b = reportHash('incomeStatement', { fiscalYearId: 'FY' }, { expenseCents: 50, incomeCents: 100 });
    expect(a).toEqual(b);
    expect(a.shortHash).toHaveLength(8);
    expect(a.hash.startsWith(a.shortHash)).toBe(true);
    expect(reportHash('incomeStatement', { fiscalYearId: 'FY' }, { incomeCents: 101, expenseCents: 50 }).hash).not.toBe(a.hash);
  });
});
