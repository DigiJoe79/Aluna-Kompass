import { describe, expect, it } from 'vitest';
import { formatPostalAddress, type PostalAddressInput } from '../src/address';

const person: PostalAddressInput = {
  kind: 'person', salutation: 'Frau', firstName: 'Anna', lastName: 'Berger',
  name: null, legalForm: null, addressExtra: null,
  street: 'Musterweg 1', postalCode: '12345', city: 'Musterstadt', country: 'DE',
};

describe('formatPostalAddress', () => {
  it('writes a person as salutation, name, street, postal code and city', () => {
    expect(formatPostalAddress(person)).toBe('Frau\nAnna Berger\nMusterweg 1\n12345 Musterstadt');
  });

  it('writes an organisation with its name and skips the legal form', () => {
    const org: PostalAddressInput = { ...person, kind: 'organization', salutation: null, firstName: null, lastName: null, name: 'Musterverein e. V.', legalForm: 'e. V.' };
    expect(formatPostalAddress(org)).toBe('Musterverein e. V.\nMusterweg 1\n12345 Musterstadt');
  });

  it('puts the organisation first and the person as an attention line', () => {
    const org: PostalAddressInput = { ...person, kind: 'organization', salutation: null, firstName: null, lastName: null, name: 'Sparkasse Musterstadt', legalForm: null, street: 'Bankplatz 2', postalCode: '12345', city: 'Musterstadt' };
    const employee: PostalAddressInput = { ...person, salutation: 'Frau', firstName: 'Bea', lastName: 'Klein', street: null, postalCode: null, city: null };
    expect(formatPostalAddress(employee, org)).toBe('Sparkasse Musterstadt\nz. Hd. Frau Bea Klein\nBankplatz 2\n12345 Musterstadt');
  });

  it('keeps the address extra above the street', () => {
    expect(formatPostalAddress({ ...person, addressExtra: 'c/o Familie Meier' })).toBe('Frau\nAnna Berger\nc/o Familie Meier\nMusterweg 1\n12345 Musterstadt');
  });

  it('drops empty lines and never leaves a lone postal code or a stray space', () => {
    expect(formatPostalAddress({ ...person, street: null, postalCode: null, city: 'Musterstadt' })).toBe('Frau\nAnna Berger\nMusterstadt');
    expect(formatPostalAddress({ ...person, street: null, postalCode: '12345', city: null })).toBe('Frau\nAnna Berger\n12345');
    expect(formatPostalAddress({ ...person, salutation: null, street: null, postalCode: null, city: null })).toBe('Anna Berger');
  });

  it('names the country only when it differs from the given home country', () => {
    const abroad: PostalAddressInput = { ...person, country: 'AT', city: 'Wien', postalCode: '1010' };
    expect(formatPostalAddress(abroad, null, 'DE')).toBe('Frau\nAnna Berger\nMusterweg 1\n1010 Wien\nAT');
    expect(formatPostalAddress(person, null, 'DE')).toBe('Frau\nAnna Berger\nMusterweg 1\n12345 Musterstadt');
  });
});
