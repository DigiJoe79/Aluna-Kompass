import { describe, expect, it } from 'vitest';
import { formatEuro, formatPercent } from '../src/format';

describe('formatPercent', () => {
  it('Promille als Prozent mit einer Nachkommastelle, Komma, geschütztes Leerzeichen wie vor „€“', () => {
    const space = formatEuro(0).slice(-2, -1);
    expect(formatPercent(184)).toBe(`18,4${space}%`);
    expect(formatPercent(250)).toBe(`25,0${space}%`);
    expect(formatPercent(0)).toBe(`0,0${space}%`);
    expect(formatPercent(1000)).toBe(`100,0${space}%`);
  });

  it('negativ mit U+2212', () => {
    const space = formatEuro(0).slice(-2, -1);
    expect(formatPercent(-30)).toBe(`−3,0${space}%`);
    expect(formatPercent(-5)).toBe(`−0,5${space}%`);
  });
});
