import { describe, expect, it } from 'vitest';
import { tripAmountCents } from '../src/ledger/trip-amount';

/** Fahrt nach Kilometersatz (F8a Annahme 4): rein, kaufmännisch auf Cent gerundet. */
describe('tripAmountCents', () => {
  it('multiplies kilometres by the rate in cents per kilometre', () => {
    expect(tripAmountCents(84, 30)).toBe(2520); // 84 km × 0,30 € = 25,20 €
    expect(tripAmountCents(1, 30)).toBe(30); // 0,30 €
    expect(tripAmountCents(33, 35)).toBe(1155); // 11,55 €
    expect(tripAmountCents(0, 30)).toBe(0);
  });

  it('rounds half a cent up, commercially — also where binary floating point falls just short', () => {
    expect(tripAmountCents(0.5, 25)).toBe(13); // 12,5 ct → 13 ct
    expect(tripAmountCents(1.5, 1)).toBe(2);
    expect(tripAmountCents(0.49, 1)).toBe(0);
    expect(tripAmountCents(1.005, 100)).toBe(101); // 100,4999… in Gleitkomma, gemeint ist 100,5
  });

  it('refuses a negative or non-finite input — a technical error, the service validates before', () => {
    for (const [km, rate] of [[-1, 30], [84, -30], [Number.NaN, 30], [84, Number.POSITIVE_INFINITY]]) {
      expect(() => tripAmountCents(km!, rate!), `${km} × ${rate}`).toThrow(RangeError);
    }
  });
});
