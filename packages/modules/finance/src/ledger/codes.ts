/**
 * Deutsches Gemeinnützigkeitsrecht ist Code, keine Einstellung (Spec E17,
 * 5.1): Sphären, Einnahmearten, Kostenfunktionen, Steuerkennzeichen. Werte
 * und Sätze dazu sind datierte Einstellungen (`dated-series.ts`).
 */
export const SPHERES = ['ideal', 'assetManagement', 'purposeOperation', 'business'] as const;
export const DIRECTIONS = ['income', 'expense', 'transit'] as const;
export const INCOME_KINDS = ['donation', 'membershipFee', 'inKindDonation', 'expenseWaiver', 'bodyGrant', 'publicGrant', 'courtFine', 'sponsoring', 'sales', 'fees', 'interest', 'inheritance', 'other'] as const;
/** Bescheinigungsfähig — und nur in der Sphäre `ideal` zulässig. */
export const CERTIFIABLE_INCOME_KINDS = ['donation', 'membershipFee', 'inKindDonation', 'expenseWaiver'] as const;
export const COST_FUNCTIONS = ['program', 'administration', 'fundraising'] as const;
export const ALLOWANCE_KINDS = ['none', 'volunteer', 'trainer'] as const;
export const TAX_CODES = ['none', 'exemptCounted', 'exemptNotCounted', 'reduced', 'standard', 'rc13b', 'icAcquisition'] as const;
export const INPUT_TAX = ['no', 'yes', 'partial'] as const;
