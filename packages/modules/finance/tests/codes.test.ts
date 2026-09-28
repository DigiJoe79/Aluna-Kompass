import { describe, expect, it } from 'vitest';
import {
  ALLOWANCE_KINDS,
  CERTIFIABLE_INCOME_KINDS,
  COST_FUNCTIONS,
  DIRECTIONS,
  INCOME_KINDS,
  INPUT_TAX,
  SPHERES,
  TAX_CODES,
} from '../src/ledger/codes';

/**
 * Deutsches Gemeinnützigkeitsrecht ist Code, keine Einstellung (Spec E17): die
 * Aufzählungen selbst sind die Prüfung — ein Test, der sie mechanisch neu
 * erfände, prüfte nichts. Was hier steht, pinnt die Werte der Spec (5.1)
 * wörtlich fest, damit eine künftige Änderung auffällt.
 */
describe('finance codes', () => {
  it('ships the enumerations of German non-profit law as code, not settings', () => {
    expect(SPHERES).toEqual(['ideal', 'assetManagement', 'purposeOperation', 'business']);
    expect(DIRECTIONS).toEqual(['income', 'expense', 'transit']);
    expect(INCOME_KINDS).toEqual(['donation', 'membershipFee', 'inKindDonation', 'expenseWaiver', 'bodyGrant', 'publicGrant', 'courtFine', 'sponsoring', 'sales', 'fees', 'interest', 'inheritance', 'other']);
    expect(COST_FUNCTIONS).toEqual(['program', 'administration', 'fundraising']);
    expect(ALLOWANCE_KINDS).toEqual(['none', 'volunteer', 'trainer']);
    expect(TAX_CODES).toEqual(['none', 'exemptCounted', 'exemptNotCounted', 'reduced', 'standard', 'rc13b', 'icAcquisition']);
    expect(INPUT_TAX).toEqual(['no', 'yes', 'partial']);
  });

  it('the four certifiable income kinds are a subset of the income kinds', () => {
    expect(CERTIFIABLE_INCOME_KINDS).toEqual(['donation', 'membershipFee', 'inKindDonation', 'expenseWaiver']);
    for (const kind of CERTIFIABLE_INCOME_KINDS) expect(INCOME_KINDS).toContain(kind);
  });
});
