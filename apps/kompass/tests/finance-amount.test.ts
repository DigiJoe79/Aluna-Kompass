import { describe, expect, it } from 'vitest';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';

describe('parseAmount', () => {
  it.each([
    ['12,5', 1250],
    ['1.234,56', 123456],
    ['12', 1200],
    ['−15,00', -1500],
    ['-15', -1500],
    ['0', 0],
    ['0,00', 0],
  ])('parses %s to %i cents', (input, expected) => {
    expect(parseAmount(input as string)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '12.50', '1,234', '12,345', '1.23,45'])('refuses %s — the dot is never a decimal point', (input) => {
    expect(parseAmount(input)).toBeNull();
  });
});

describe('formatAmount', () => {
  it('groups thousands with a dot, two decimals with a comma, minus as U+2212', () => {
    expect(formatAmount(123456)).toBe('1.234,56');
    expect(formatAmount(1200)).toBe('12,00');
    expect(formatAmount(-6000)).toBe('−60,00');
    expect(formatAmount(0)).toBe('0,00');
  });
});

describe('formatEuro', () => {
  it('adds the euro sign after the formatted amount', () => {
    expect(formatEuro(123456)).toBe('1.234,56 €');
    expect(formatEuro(-6000)).toBe('−60,00 €');
  });
});
