import { describe, expect, it } from 'vitest';
import { defineModule } from '../src/modules/manifest';

// Spec Mitglieder und Lastschrift § 6.1: Ein Modul meldet die Herkunftstypen seiner offenen Posten an.
const withOrigins = (types: string[]) => defineModule({ key: 'members', version: '0', permissions: [], openItemOrigins: types.map((type) => ({ type })) });

describe('defineModule openItemOrigins', () => {
  it('nimmt gültige, eindeutige Herkunftstypen an', () => {
    expect(withOrigins(['memberFeeCharge', 'memberAdmissionFee']).openItemOrigins).toEqual([{ type: 'memberFeeCharge' }, { type: 'memberAdmissionFee' }]);
  });

  it('lehnt ungültige Typ-Schlüssel ab', () => {
    expect(() => withOrigins(['member fee'])).toThrow('invalid open item origin type: members/member fee');
    expect(() => withOrigins(['Mf'])).toThrow('invalid open item origin type');
    expect(() => withOrigins(['ab'])).toThrow('invalid open item origin type');
  });

  it('lehnt doppelte Typen im selben Modul ab', () => {
    expect(() => withOrigins(['memberFeeCharge', 'memberFeeCharge'])).toThrow('duplicate open item origin: members/memberFeeCharge');
  });
});
