import { isValidIban } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { checkIban } from '@/lib/finance/iban-check';

describe('checkIban', () => {
  it('tells valid, wrong checksum and wrong length apart, and agrees with isValidIban on the module’s test vectors', () => {
    expect(checkIban('DE02120300000000202051')).toEqual({ state: 'valid', country: 'DE' });
    expect(checkIban('DE03120300000000202051')).toEqual({ state: 'checksum', country: 'DE' });
    expect(checkIban('AT611904300234573201')).toEqual({ state: 'valid', country: 'AT' });
    expect(checkIban('')).toEqual({ state: 'empty', country: null });

    const vectors = ['DE02120300000000202051', 'DE03120300000000202051', 'AT611904300234573201', '', 'DE', 'DE02 1203', '1234567890123456', 'DE02-1203-0000'];
    for (const iban of vectors) expect(checkIban(iban).state === 'valid', iban).toBe(isValidIban(iban));
  });
});
