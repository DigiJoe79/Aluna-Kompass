import { describe, expect, it } from 'vitest';
import { dedupKey, normalizePurpose } from '../src/import/dedup';

describe('normalizePurpose', () => {
  it('folds case, whitespace and umlauts in the purpose and looks only at its beginning', () => {
    const a = normalizePurpose('Büro Bedarf März');
    const b = normalizePurpose('  BÜROBEDARF   MÄRZ  ');
    expect(a).toBe(b);
    expect(a).toBe('buerobedarfmaerz');

    const long = normalizePurpose('a'.repeat(50));
    expect(long).toHaveLength(40);
    expect(normalizePurpose(`${'a'.repeat(40)}unterschied`)).toBe(long);
  });
});

describe('dedupKey', () => {
  const line = { bookingDate: '2026-03-05', amountCents: 5000, counterpartyIban: 'DE66999999991234567890', purpose: 'Spende' };

  it('gives two identical lines on one day different keys by their ordinal', () => {
    expect(dedupKey(line, 0)).not.toBe(dedupKey(line, 1));
  });

  it('gives the same line the same key across two files', () => {
    const fileA = { ...line };
    const fileB = { ...line };
    expect(dedupKey(fileA, 2)).toBe(dedupKey(fileB, 2));
  });

  it('changes when the account or amount differs', () => {
    expect(dedupKey(line, 0)).not.toBe(dedupKey({ ...line, amountCents: 5001 }, 0));
    expect(dedupKey(line, 0)).not.toBe(dedupKey({ ...line, counterpartyIban: null }, 0));
  });
});
