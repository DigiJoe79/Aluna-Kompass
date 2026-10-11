import { describe, expect, it } from 'vitest';
import { formatAmount, formatEuro } from '../src/format';

describe('formatAmount', () => {
  it('Tausenderpunkt, Dezimalkomma, Minus als U+2212', () => {
    expect(formatAmount(123456)).toBe('1.234,56');
    expect(formatAmount(123456789)).toBe('1.234.567,89');
    expect(formatAmount(1200)).toBe('12,00');
    expect(formatAmount(-6000)).toBe('−60,00');
    expect(formatAmount(-5)).toBe('−0,05');
    expect(formatAmount(0)).toBe('0,00');
  });

  it('sign: always setzt „+“ vor positive Beträge, 0 bleibt ohne', () => {
    expect(formatAmount(1200, { sign: 'always' })).toBe('+12,00');
    expect(formatAmount(-1200, { sign: 'always' })).toBe('−12,00');
    expect(formatAmount(0, { sign: 'always' })).toBe('0,00');
  });
});

describe('formatEuro', () => {
  it('hängt „€“ mit geschütztem Leerzeichen an', () => {
    expect(formatEuro(123456)).toBe('1.234,56 €');
    expect(formatEuro(-6000)).toBe('−60,00 €');
    expect(formatEuro(0)).toBe('0,00 €');
    expect(formatEuro(1250, { sign: 'always' })).toBe('+12,50 €');
  });
});
