import { describe, expect, it } from 'vitest';
import { isValidIban, maskIban, normalizeIban } from '../src/ledger/iban';

describe('IBAN', () => {
  it('normalizes spacing and case', () => expect(normalizeIban(' de23 9999 9999 0000 2020 51 ')).toBe('DE23999999990000202051'));
  it('accepts a valid check digit and refuses a wrong one', () => {
    expect(isValidIban('DE23999999990000202051')).toBe(true);
    expect(isValidIban('DE24999999990000202051')).toBe(false);
    expect(isValidIban('AT939999900001234567')).toBe(true);
  });
  it('refuses nonsense', () => { for (const s of ['', 'DE', 'DE02 1203', '1234567890123456', 'DE02-1203-0000']) expect(isValidIban(s)).toBe(false); });
  it('masks all but the first and the last four characters for lists (F8a)', () => {
    expect(maskIban('DE66 9999 9999 1234 5678 90')).toBe('DE66 **** **** **** **78 90');
    expect(maskIban('at939999900001234567')).toBe('AT93 **** **** **** 4567');
  });
});
