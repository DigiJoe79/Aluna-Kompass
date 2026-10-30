import { describe, expect, it } from 'vitest';
import { categoryFieldsSchema } from '../src/ledger/categories';
import { START_PLAN } from '../src/ledger/start-plan';

describe('start plan', () => {
  it('holds categories with distinct keys, each valid by the rules every category obeys', () => {
    expect(START_PLAN.length).toBeGreaterThan(20);
    for (const c of START_PLAN) expect(categoryFieldsSchema.safeParse(c).success, c.key).toBe(true);
    expect(new Set(START_PLAN.map((c) => c.key)).size).toBe(START_PLAN.length);
  });

  it('is generic: no animal and no association-specific wording', () => {
    expect(JSON.stringify(START_PLAN)).not.toMatch(/tier|hund|katze|aluna|futter|tierarzt|schutzgebühr/i);
  });

  it('marks what the account statement alone proves', () => {
    const suffices = START_PLAN.filter((c) => c.statementSuffices).map((c) => c.key).sort();
    expect(suffices).toEqual(['bank-fees', 'court-fines', 'donations', 'interest', 'membership-fees', 'payment-fees', 'platform-payouts', 'vat-payment', 'vat-refund', 'withheld-capital-tax'].sort());
  });

  it('flags inheritances, allowances and the transit category as the spec says', () => {
    const by = Object.fromEntries(START_PLAN.map((c) => [c.key, c]));
    expect(by['not-ours']).toMatchObject({ direction: 'transit' });
    expect(by['volunteer-allowance']).toMatchObject({ allowanceKind: 'volunteer', costFunction: 'administration' });
    expect(by['trainer-allowance']).toMatchObject({ allowanceKind: 'trainer', costFunction: 'program' });
    expect(by['sales']).toMatchObject({ sphere: 'business', incomeKind: 'sales', countsTowardTurnover: true, defaultTaxCode: 'standard' });
  });

  it('ordnet nach DZI zu: Zahlungsdienstgebühren als Verwaltung, Webseite als Werbung, Plattform bestätigt selbst', () => {
    const by = Object.fromEntries(START_PLAN.map((c) => [c.key, c]));
    expect(by['payment-fees']).toMatchObject({ costFunction: 'administration' });
    expect(by['website-pr']).toMatchObject({ direction: 'expense', sphere: 'ideal', costFunction: 'fundraising' });
    expect(START_PLAN.findIndex((c) => c.key === 'website-pr')).toBe(START_PLAN.findIndex((c) => c.key === 'it') + 1);
    expect(by['platform-payouts']).toMatchObject({ incomeKind: 'bodyGrant', donationPlatform: 'confirmsItself' });
  });
});
