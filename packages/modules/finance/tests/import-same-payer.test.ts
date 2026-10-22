import { describe, expect, it } from 'vitest';
import { samePayer } from '../src/import/runs';

/**
 * Befund 3 (2026-10-20): Zwei Zahlungen am selben Tag über den gleichen Betrag galten als „dieselbe Zahlung, anders
 * beschriftet“, ohne den Zahler zu prüfen. Die IBAN entscheidet; der Name nur, wo eine Seite keine IBAN trägt — er
 * ist zwischen Exportformaten zu unbeständig, um eine gleiche IBAN zu überstimmen.
 */
const IBAN_A = 'DE11999999990000000001';
const IBAN_B = 'DE22999999990000000002';

describe('samePayer', () => {
  it('rejects different IBANs, even with the same name', () => {
    expect(samePayer({ iban: IBAN_A, name: 'Max Muster' }, { iban: IBAN_B, name: 'Max Muster' })).toBe(false);
  });

  it('accepts the same IBAN whatever the names say (exports spell names differently)', () => {
    expect(samePayer({ iban: IBAN_A, name: 'MUSTER, MAX' }, { iban: IBAN_A, name: 'Max Muster' })).toBe(true);
    expect(samePayer({ iban: IBAN_A, name: 'Max Muster' }, { iban: IBAN_A, name: null })).toBe(true);
  });

  it('compares IBANs without spaces and case', () => {
    expect(samePayer({ iban: 'DE11 9999 9999 0000 0000 01', name: null }, { iban: IBAN_A, name: null })).toBe(true);
  });

  it('falls back to the name when one or both sides have no IBAN (PayPal, CSV without IBAN column)', () => {
    expect(samePayer({ iban: IBAN_A, name: 'Erika Beispiel' }, { iban: null, name: 'erika  beispiel' })).toBe(true);
    expect(samePayer({ iban: null, name: 'Jörg Muster' }, { iban: null, name: 'Joerg Muster' })).toBe(true);
    expect(samePayer({ iban: null, name: 'Erika Beispiel' }, { iban: null, name: 'Max Muster' })).toBe(false);
  });

  it('does not assume the same payer when neither IBAN nor name can be compared', () => {
    expect(samePayer({ iban: null, name: null }, { iban: null, name: null })).toBe(false);
    expect(samePayer({ iban: IBAN_A, name: null }, { iban: null, name: 'Max Muster' })).toBe(false);
  });
});
