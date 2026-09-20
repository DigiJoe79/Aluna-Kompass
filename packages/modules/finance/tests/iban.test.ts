import { describe, expect, it } from 'vitest';
import { isValidIban, normalizeIban } from '../src/ledger/iban';

describe('IBAN', () => {
  it('normalizes spacing and case', () => expect(normalizeIban(' de02 1203 0000 0000 2020 51 ')).toBe('DE02120300000000202051'));
  it('accepts a valid check digit and refuses a wrong one', () => {
    expect(isValidIban('DE02120300000000202051')).toBe(true);
    expect(isValidIban('DE03120300000000202051')).toBe(false);
    expect(isValidIban('AT611904300234573201')).toBe(true);
  });
  it('refuses nonsense', () => { for (const s of ['', 'DE', 'DE02 1203', '1234567890123456', 'DE02-1203-0000']) expect(isValidIban(s)).toBe(false); });
});
