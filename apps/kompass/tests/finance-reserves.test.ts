import { describe, expect, it } from 'vitest';
import { reserveBalanceAfter, RESERVE_KINDS } from '@/lib/finance/reserves';

describe('reserve dialog arithmetic (F8b Task 6b, Design 4d)', () => {
  it('adds an allocation, subtracts a withdrawal and empties on dissolve', () => {
    expect(reserveBalanceAfter(10000, 'allocate', 2500)).toBe(12500);
    expect(reserveBalanceAfter(10000, 'withdraw', 2500)).toBe(7500);
    expect(reserveBalanceAfter(10000, 'dissolve', null)).toBe(0);
  });

  it('treats a missing amount as nothing yet', () => {
    expect(reserveBalanceAfter(10000, 'allocate', null)).toBe(10000);
  });

  it('lists the four kinds in the order of the design', () => {
    expect(RESERVE_KINDS).toEqual(['projectFunds', 'replacement', 'free', 'participation']);
  });
});
