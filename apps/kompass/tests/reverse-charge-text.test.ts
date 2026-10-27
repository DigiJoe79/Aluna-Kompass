import { describe, expect, it } from 'vitest';
import { reverseChargeLineFacts, type VatLineContext } from '@/lib/finance/reverse-charge-text';

const small: VatLineContext = { taxation: 'smallBusiness', rates: { standard: 19, reduced: 7 }, periodKinds: { 2025: 'quarter', 2026: 'quarter', 2027: 'quarter' } };
const base = { amountCents: -20000, taxCode: 'rc13bEu', rateKind: 'standard' as const, entryDate: '2026-07-03', serviceDate: '2026-06-30' as string | null, context: small };

/** Plan E6a Task 11c — der Satz unter der Buchungszeile (Board 3a), rein gerechnet. */
describe('reverseChargeLineFacts', () => {
  it('computes tax, base and the counting period from the service date', () => {
    expect(reverseChargeLineFacts(base)).toEqual({ taxCents: 3800, ratePercent: 19, baseCents: 20000, period: '2026-Q2', servicePeriod: '2026-Q2', entryPeriod: '2026-Q3', noInputTax: true });
  });

  it('counts by the booking without a service date and for a prepayment', () => {
    expect(reverseChargeLineFacts({ ...base, serviceDate: null })).toMatchObject({ period: '2026-Q3', servicePeriod: null, entryPeriod: '2026-Q3' });
    expect(reverseChargeLineFacts({ ...base, entryDate: '2026-06-15', serviceDate: '2026-07-01' })).toMatchObject({ period: '2026-Q2', servicePeriod: '2026-Q3', entryPeriod: '2026-Q2' });
  });

  it('follows the period kind of the year and the taxation', () => {
    expect(reverseChargeLineFacts({ ...base, context: { ...small, periodKinds: { ...small.periodKinds, 2026: 'month' } } })).toMatchObject({ period: '2026-06', entryPeriod: '2026-07' });
    expect(reverseChargeLineFacts({ ...base, context: { ...small, taxation: 'regular' } })).toMatchObject({ noInputTax: false });
    expect(reverseChargeLineFacts({ ...base, rateKind: 'reduced', amountCents: -10000 })).toMatchObject({ taxCents: 700, ratePercent: 7 });
  });

  it('says nothing without a reverse-charge code or amount', () => {
    expect(reverseChargeLineFacts({ ...base, taxCode: 'standard' })).toBeNull();
    expect(reverseChargeLineFacts({ ...base, taxCode: undefined })).toBeNull();
    expect(reverseChargeLineFacts({ ...base, amountCents: 0 })).toBeNull();
  });
});

describe('Vorgabe vom Kontakt (Board 3a, Herkunft)', () => {
  it('sets the code on an expense row without one and marks the origin', async () => {
    const { withContactReverseCharge } = await import('@/lib/finance/entry-form');
    const row: { key: string; taxCode?: string; contactId: string } = { key: 'r', contactId: 'k' };
    expect(withContactReverseCharge(row, true, 'eu')).toMatchObject({ taxCode: 'rc13bEu', taxCodeOrigin: 'contact' });
    expect(withContactReverseCharge(row, true, 'other')).toMatchObject({ taxCode: 'rc13bOther', taxCodeOrigin: 'contact' });
    expect(withContactReverseCharge(row, false, 'eu')).toBe(row);
    expect(withContactReverseCharge({ ...row, taxCode: 'standard' }, true, 'eu')).toMatchObject({ taxCode: 'standard' });
    expect(withContactReverseCharge(row, true, null)).toBe(row);
  });
});
