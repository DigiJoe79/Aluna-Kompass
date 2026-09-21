import { describe, expect, it } from 'vitest';
import { matchesDirection, suggestSettlementCents } from '@/lib/finance/settlement';

describe('suggestSettlementCents', () => {
  it('suggests the open rest, capped by what the money line has left, never below zero', () => {
    expect(suggestSettlementCents({ openCents: 5000, lineCents: 10000, alreadySettledCents: 0 })).toBe(5000);
    expect(suggestSettlementCents({ openCents: 12000, lineCents: 8000, alreadySettledCents: 0 })).toBe(8000);
    expect(suggestSettlementCents({ openCents: 5000, lineCents: 8000, alreadySettledCents: 8000 })).toBe(0);
    expect(suggestSettlementCents({ openCents: 5000, lineCents: 3000, alreadySettledCents: 4000 })).toBe(0);
  });
});

describe('matchesDirection', () => {
  it('offers receivables for incoming and payables for outgoing lines', () => {
    expect(matchesDirection('receivable', 'in')).toBe(true);
    expect(matchesDirection('receivable', 'out')).toBe(false);
    expect(matchesDirection('payable', 'out')).toBe(true);
    expect(matchesDirection('payable', 'in')).toBe(false);
  });
});
