import { describe, expect, it } from 'vitest';
import { euroBase, VAT_FORMS, vatFormFor, type VatFigureGroup } from '../src/reporting/vat-forms';

const GROUP_ORDER: VatFigureGroup[] = ['general', 'ownSupplies', 'acquisition', 'reverseCharge', 'inputTax', 'result'];

/** Plan E6b Task 3 — Kennzahlen datiert. */
describe('VAT forms', () => {
  it('knows the advance return from 2026 on, in the order of the form', () => {
    const form = vatFormFor('advance', 2026)!;
    const codes = form.figures.map((f) => f.code);
    for (const code of ['10', '46', '47', '84', '85', '83', '81', '86', '48', '89', '93', '66', '61', '67']) expect(codes).toContain(code);
    expect(codes.indexOf('46')).toBeLessThan(codes.indexOf('47'));
    expect(codes.indexOf('47')).toBeLessThan(codes.indexOf('84'));
    expect(codes.indexOf('85')).toBeLessThan(codes.indexOf('83'));
    const groups = form.figures.map((f) => GROUP_ORDER.indexOf(f.group));
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
    expect(vatFormFor('advance', 2027)).toBe(form);
  });

  it('knows the advance return 2025 with the codes and wording of 2026, none before (E11, Befund 34 c)', () => {
    const y2025 = vatFormFor('advance', 2025)!;
    expect(y2025.validFromYear).toBe(2025);
    expect(y2025.assumed).toBeUndefined();
    expect(y2025.figures).toEqual(vatFormFor('advance', 2026)!.figures);
    expect(vatFormFor('advance', 2024)).toBeNull();
  });

  it('has the checked annual form 2026 with the codes of 2025', () => {
    expect(vatFormFor('annual', 2026)!.assumed).toBeUndefined();
    expect(vatFormFor('annual', 2026)!.validFromYear).toBe(2026);
    expect(vatFormFor('annual', 2025)!.assumed).toBeUndefined();
    expect(vatFormFor('annual', 2024)).toBeNull();
    expect(vatFormFor('annual', 2026)!.figures.map((f) => f.code)).toEqual(vatFormFor('annual', 2025)!.figures.map((f) => f.code));
    for (const code of ['846', '847', '877', '878', '781', '793', '761', '467', '236']) expect(vatFormFor('annual', 2025)!.figures.map((f) => f.code)).toContain(code);
  });

  it('keeps sources and codes unique per form and taxation', () => {
    for (const form of VAT_FORMS) {
      for (const taxation of ['regular', 'smallBusiness'] as const) {
        const sources = form.figures.filter((f) => f.taxation === undefined || f.taxation === taxation).map((f) => f.source);
        expect(new Set(sources).size).toBe(sources.length);
      }
      const keys = form.figures.map((f) => `${f.code}|${f.taxation ?? ''}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('cuts cents from a base', () => {
    expect(euroBase(20099)).toBe(200);
    expect(euroBase(-20099)).toBe(-200);
    expect(euroBase(0)).toBe(0);
  });
});
