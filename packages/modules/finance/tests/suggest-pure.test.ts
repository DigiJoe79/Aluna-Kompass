import { describe, expect, it } from 'vitest';
import { findPair, isCashKeyword, type RawLike } from '../src/import/suggest/pair';
import { findByReference } from '../src/import/suggest/reference';
import { findReturnOrigin } from '../src/import/suggest/return';
import { paymentServiceHint } from '../src/import/suggest/text';

const raw = (o: Partial<RawLike> & { id: string }): RawLike => ({ accountId: 'BANK', bookingDate: '2026-03-10', amountCents: -10000, counterpartyIban: null, ...o });
const OPTS = { matchDays: 3, feeToleranceCents: 500 };

describe('findPair', () => {
  it('pairs opposite amounts on another own account within the window', () => {
    const target = raw({ id: 'T' });
    const other = raw({ id: 'O', accountId: 'SAVINGS', amountCents: 10000, bookingDate: '2026-03-12' });
    expect(findPair(target, [other], OPTS)).toEqual({ other, feeCents: 0 });
  });

  it('never pairs with the same account, the same sign or itself', () => {
    const target = raw({ id: 'T' });
    expect(findPair(target, [target, raw({ id: 'A', amountCents: 10000 }), raw({ id: 'B', accountId: 'SAVINGS', amountCents: -10000 })], OPTS)).toBeNull();
  });

  it('keeps the date window inclusive: matchDays apart pairs, one day more does not', () => {
    const target = raw({ id: 'T' });
    expect(findPair(target, [raw({ id: 'O', accountId: 'S', amountCents: 10000, bookingDate: '2026-03-13' })], OPTS)).not.toBeNull();
    expect(findPair(target, [raw({ id: 'O', accountId: 'S', amountCents: 10000, bookingDate: '2026-03-06' })], OPTS)).toBeNull();
    expect(findPair(target, [raw({ id: 'O', accountId: 'S', amountCents: 10000, bookingDate: '2026-03-14' })], OPTS)).toBeNull();
  });

  it('accepts a fee up to the tolerance as the part that did not arrive, never more and never a surplus', () => {
    const payout = raw({ id: 'T', accountId: 'PAY', amountCents: -50000 });
    expect(findPair(payout, [raw({ id: 'O', accountId: 'BANK', amountCents: 49500 })], OPTS)).toMatchObject({ feeCents: 500 });
    expect(findPair(payout, [raw({ id: 'O', accountId: 'BANK', amountCents: 49499 })], OPTS)).toBeNull();
    // Mehr angekommen als abgegangen ist keine Gebühr.
    expect(findPair(payout, [raw({ id: 'O', accountId: 'BANK', amountCents: 50100 })], OPTS)).toBeNull();
    // Von der Empfängerseite aus gesehen dieselbe Gebühr.
    const receipt = raw({ id: 'R', accountId: 'BANK', amountCents: 48500 });
    expect(findPair(receipt, [raw({ id: 'P', accountId: 'PAY', amountCents: -50000 })], { matchDays: 3, feeToleranceCents: 1500 })).toMatchObject({ feeCents: 1500 });
  });

  it('prefers the smallest difference, then the nearest date', () => {
    const target = raw({ id: 'T' });
    const far = raw({ id: 'FAR', accountId: 'S', amountCents: 10000, bookingDate: '2026-03-13' });
    const near = raw({ id: 'NEAR', accountId: 'S', amountCents: 10000, bookingDate: '2026-03-11' });
    const fee = raw({ id: 'FEE', accountId: 'S', amountCents: 9900, bookingDate: '2026-03-10' });
    expect(findPair(target, [fee, far, near], OPTS)?.other.id).toBe('NEAR');
    expect(findPair(target, [fee, far], OPTS)?.other.id).toBe('FAR');
  });
});

describe('isCashKeyword', () => {
  const keywords = ['Bareinzahlung', 'Geldautomat', 'Einzahlung Bargeld'];
  it('finds a keyword regardless of case, spaces and umlauts', () => {
    expect(isCashKeyword('BAREINZAHLUNG Spendendose', keywords)).toBe(true);
    expect(isCashKeyword('Auszahlung GELD AUTOMAT Hauptstr.', keywords)).toBe(true);
    expect(isCashKeyword('Einzahlung  bargeld Filiale', keywords)).toBe(true);
    expect(isCashKeyword('Überweisung Bäckerei', ['überweisung'])).toBe(true);
  });
  it('finds nothing without a keyword, and ignores empty keywords', () => {
    expect(isCashKeyword('Mitgliedsbeitrag', keywords)).toBe(false);
    expect(isCashKeyword('Mitgliedsbeitrag', ['', '  '])).toBe(false);
  });
});

describe('findReturnOrigin', () => {
  const origin = { ...raw({ id: 'O', amountCents: 2500, bookingDate: '2026-02-01', counterpartyIban: 'DE66999999991234567890' }), allocationLineId: 'L1', categoryId: 'C' };
  const target = { ...raw({ id: 'T', amountCents: -2500, bookingDate: '2026-02-10', counterpartyIban: 'DE66 9999 9999 1234 5678 90' }), returnCode: 'AC04' };

  it('finds the earlier booking with the same iban and the negated amount', () => {
    expect(findReturnOrigin(target, [origin])).toBe(origin);
  });
  it('needs a return code', () => {
    expect(findReturnOrigin({ ...target, returnCode: null }, [origin])).toBeNull();
  });
  it('needs the same iban, the negated amount and an earlier date within 60 days', () => {
    expect(findReturnOrigin(target, [{ ...origin, counterpartyIban: 'DE23999999990000202051' }])).toBeNull();
    expect(findReturnOrigin(target, [{ ...origin, amountCents: 2600 }])).toBeNull();
    expect(findReturnOrigin(target, [{ ...origin, bookingDate: '2026-02-11' }])).toBeNull();
    expect(findReturnOrigin({ ...target, bookingDate: '2026-04-03' }, [origin])).toBeNull(); // 61 Tage
    expect(findReturnOrigin({ ...target, bookingDate: '2026-04-02' }, [origin])).toBe(origin); // genau 60
  });
  it('takes the most recent of several origins', () => {
    const later = { ...origin, id: 'O2', bookingDate: '2026-02-05', allocationLineId: 'L2' };
    expect(findReturnOrigin(target, [origin, later])).toBe(later);
  });
});

describe('findByReference', () => {
  const items = [
    { id: 'A', paymentReference: 'RE-4711' },
    { id: 'B', paymentReference: null },
    { id: 'C', paymentReference: 'RE-47' },
  ];
  it('finds an item whose reference stands whole in the purpose, ignoring case and spaces', () => {
    expect(findByReference('Rechnung re - 4711 vom März', items)).toBe('A');
  });
  it('prefers the longest reference when several stand in the purpose', () => {
    expect(findByReference('RE-4711', items)).toBe('A');
    expect(findByReference('RE-4799', items)).toBe('C');
  });
  it('finds nothing without a reference in the purpose', () => {
    expect(findByReference('Spende', items)).toBeNull();
    expect(findByReference('', [{ id: 'E', paymentReference: '' }])).toBeNull();
  });
});

describe('paymentServiceHint', () => {
  it('hints at a foreign iban, never at a German one or none', () => {
    expect(paymentServiceHint('AT611904300234573201')).toBe('foreignIban');
    expect(paymentServiceHint('de66 9999 9999 1234 5678 90')).toBeNull();
    expect(paymentServiceHint(null)).toBeNull();
    expect(paymentServiceHint('  ')).toBeNull();
  });
});
