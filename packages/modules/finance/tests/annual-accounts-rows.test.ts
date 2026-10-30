import { describe, expect, it } from 'vitest';
import { INCOME_KINDS, SPHERES } from '../src/ledger/codes';
import { INCOME_ROWS, incomeRowOf } from '../src/reporting/reports/annual-accounts-rows';

const line = (incomeKind: (typeof INCOME_KINDS)[number] | null, over: Partial<Parameters<typeof incomeRowOf>[0]> = {}) => incomeRowOf({ incomeKind, sphere: 'ideal', donationPlatform: null, waiverPassed: false, ...over });

describe('Zuordnung Einnahmenart → Zeile der Mittelherkunft (J1 Task 5)', () => {
  it('hat für jede Art in jedem Bereich eine Zeile', () => {
    for (const kind of [...INCOME_KINDS, null]) {
      for (const sphere of SPHERES) {
        for (const waiverPassed of [true, false]) {
          expect(INCOME_ROWS, `${kind}/${sphere}`).toContain(incomeRowOf({ incomeKind: kind, sphere, donationPlatform: null, waiverPassed }));
        }
      }
    }
  });

  it('ordnet die Arten nach der Tabelle der Spec zu', () => {
    expect(line('donation')).toBe('cashDonations');
    expect(line('inKindDonation')).toBe('inKindDonations');
    expect(line('inheritance')).toBe('bequests');
    expect(line('membershipFee')).toBe('membershipFees');
    expect(line('publicGrant')).toBe('publicGrants');
    expect(line('bodyGrant')).toBe('otherOrganizations');
    expect(line('courtFine')).toBe('courtFines');
    expect(line('sales', { sphere: 'business' })).toBe('revenue');
    expect(line('interest', { sphere: 'assetManagement' })).toBe('assetManagement');
    expect(line('rent', { sphere: 'assetManagement' })).toBe('assetManagement');
    expect(line('other')).toBe('other');
    expect(line(null)).toBe('other');
  });

  it('kennt die Sonderfälle: Plattform, Aufwandsverzicht, Entgelte, Sponsoring', () => {
    expect(line('bodyGrant', { donationPlatform: 'confirmsItself' })).toBe('cashDonations');
    expect(line('donation', { donationPlatform: 'handlesOnly' })).toBe('cashDonations');
    expect(line('expenseWaiver', { waiverPassed: true })).toBe('cashDonations');
    expect(line('expenseWaiver', { waiverPassed: false })).toBe('other');
    expect(line('fees', { sphere: 'assetManagement' })).toBe('assetManagement');
    expect(line('fees', { sphere: 'purposeOperation' })).toBe('revenue');
    expect(line('sponsoring', { sphere: 'business' })).toBe('revenue');
    expect(line('sponsoring', { sphere: 'ideal' })).toBe('other');
    expect(line('sponsoring', { sphere: 'assetManagement' })).toBe('other');
  });

  it('steht in der Reihenfolge der Spec, Geldauflagen nach den anderen Organisationen', () => {
    expect(INCOME_ROWS).toEqual(['cashDonations', 'inKindDonations', 'bequests', 'membershipFees', 'publicGrants', 'otherOrganizations', 'courtFines', 'revenue', 'assetManagement', 'other']);
  });
});
