import { describe, expect, it } from 'vitest';
import { taxOf } from '../src/ledger/tax';

const rates = { standard: 19, reduced: 7 };
const base = { rateKind: 'standard' as const, inputTaxDeductible: 'no' as const, rates };

describe('taxOf', () => {
  it('Prüfstein 10: 350 € brutto zu 7 % — unter Regelbesteuerung 22,90 € Steuer, als Kleinunternehmer keine', () => {
    expect(taxOf({ ...base, amountCents: 35000, taxCode: 'reduced', taxation: 'regular' })).toMatchObject({ outputTaxCents: 2290, netCents: 32710 });
    expect(taxOf({ ...base, amountCents: 35000, taxCode: 'reduced', taxation: 'smallBusiness' })).toMatchObject({ outputTaxCents: 0, netCents: 35000 });
  });

  it('Prüfstein „Leistung aus dem Ausland“: 100 € netto nach § 13b — 19 € geschuldet, auch als Kleinunternehmer', () => {
    for (const taxation of ['smallBusiness', 'regular'] as const) {
      expect(taxOf({ ...base, amountCents: -10000, taxCode: 'rc13b', taxation })).toMatchObject({ reverseChargeTaxCents: 1900, outputTaxCents: 0, netCents: -10000 });
    }
    expect(taxOf({ ...base, amountCents: -10000, taxCode: 'icAcquisition', rateKind: 'reduced', taxation: 'smallBusiness' }).reverseChargeTaxCents).toBe(700);
  });

  it('input tax only under regular taxation and only when the category allows it', () => {
    const expense = { ...base, amountCents: -11900, taxCode: 'standard' as const };
    expect(taxOf({ ...expense, taxation: 'regular', inputTaxDeductible: 'yes' })).toMatchObject({ inputTaxCents: 1900, inputTaxMemoCents: 0, netCents: -10000 });
    expect(taxOf({ ...expense, taxation: 'regular', inputTaxDeductible: 'partial' })).toMatchObject({ inputTaxCents: 0, inputTaxMemoCents: 1900 });
    expect(taxOf({ ...expense, taxation: 'regular', inputTaxDeductible: 'no' })).toMatchObject({ inputTaxCents: 0, inputTaxMemoCents: 0 });
    expect(taxOf({ ...expense, taxation: 'smallBusiness', inputTaxDeductible: 'yes' })).toMatchObject({ inputTaxCents: 0, netCents: -11900 });
  });

  it('reverse charge under regular taxation is owed and deductible at once', () => {
    expect(taxOf({ ...base, amountCents: -10000, taxCode: 'rc13b', taxation: 'regular', inputTaxDeductible: 'yes' })).toMatchObject({ reverseChargeTaxCents: 1900, inputTaxCents: 1900 });
  });

  it('exempt and none carry no tax; rounding is to the cent, half up', () => {
    for (const taxCode of ['none', 'exemptCounted', 'exemptNotCounted'] as const) expect(taxOf({ ...base, amountCents: 5000, taxCode, taxation: 'regular' })).toMatchObject({ outputTaxCents: 0, reverseChargeTaxCents: 0, inputTaxCents: 0, netCents: 5000 });
    expect(taxOf({ ...base, amountCents: 100, taxCode: 'standard', taxation: 'regular' })).toMatchObject({ outputTaxCents: 16, netCents: 84 });
    expect(taxOf({ ...base, amountCents: -100, taxCode: 'standard', taxation: 'regular', inputTaxDeductible: 'yes' })).toMatchObject({ inputTaxCents: 16, netCents: -84 });
  });
});
