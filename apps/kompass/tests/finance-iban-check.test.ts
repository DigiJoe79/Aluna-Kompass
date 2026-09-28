import { formatIban, isValidIban } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { checkIban, groupIban } from '@/lib/finance/iban-check';

describe('checkIban', () => {
  it('tells valid, wrong checksum and wrong length apart, and agrees with isValidIban on the module’s test vectors', () => {
    expect(checkIban('DE23999999990000202051')).toEqual({ state: 'valid', country: 'DE' });
    expect(checkIban('DE24999999990000202051')).toEqual({ state: 'checksum', country: 'DE' });
    expect(checkIban('AT939999900001234567')).toEqual({ state: 'valid', country: 'AT' });
    expect(checkIban('')).toEqual({ state: 'empty', country: null });

    const vectors = ['DE23999999990000202051', 'DE24999999990000202051', 'AT939999900001234567', '', 'DE', 'DE02 1203', '1234567890123456', 'DE02-1203-0000'];
    for (const iban of vectors) expect(checkIban(iban).state === 'valid', iban).toBe(isValidIban(iban));
  });

  it('groups an iban in fours for reading, like formatIban in the module (N3, W-1)', () => {
    expect(groupIban('DE18999999990000710712')).toBe('DE18 9999 9999 0000 7107 12');
    for (const iban of ['DE18999999990000710712', 'de18 9999 9999 0000 7107 12', 'AT939999900001234567', '']) expect(groupIban(iban), iban).toBe(formatIban(iban));
  });
});
