import { describe, expect, it } from 'vitest';
import { taxTextKey } from '@/lib/finance/tax-text';

describe('taxTextKey', () => {
  it('names included tax, reverse-charge tax and nothing for a tax-free line', () => {
    expect(taxTextKey({ outputTaxCents: 2290, reverseChargeTaxCents: 0, inputTaxCents: 0, inputTaxMemoCents: 0, netCents: 10000 })).toEqual({
      key: 'included',
      cents: 2290,
    });
    expect(taxTextKey({ outputTaxCents: 0, reverseChargeTaxCents: 1900, inputTaxCents: 0, inputTaxMemoCents: 0, netCents: 10000 })).toEqual({
      key: 'reverseCharge',
      cents: 1900,
    });
    expect(taxTextKey({ outputTaxCents: 0, reverseChargeTaxCents: 0, inputTaxCents: 0, inputTaxMemoCents: 0, netCents: 10000 })).toBeNull();
    expect(taxTextKey(null)).toBeNull();
  });
});
