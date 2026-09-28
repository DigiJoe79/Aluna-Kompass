import { describe, expect, it } from 'vitest';
import { normalizeText, ruleMatches, type RuleConditions, type RuleTarget } from '../src/rules-pure';

const NONE: RuleConditions = { accountId: null, direction: null, counterpartyIban: null, textContains: null, amountMinCents: null, amountMaxCents: null };
const TARGET: RuleTarget = {
  bookingDate: '2026-03-05',
  accountId: 'A1',
  amountCents: -2499,
  counterpartyName: 'Schreibwaren Müller',
  counterpartyIban: 'DE66999999991234567890',
  purpose: 'Rechnung 17 Büromaterial',
};
const matches = (c: Partial<RuleConditions>, t: Partial<RuleTarget> = {}) => ruleMatches({ ...NONE, ...c }, { ...TARGET, ...t });

describe('normalizeText', () => {
  it('folds case, umlauts and ß, and removes every whitespace — without cutting at 40 like the dedup key', () => {
    expect(normalizeText('  Büro Material ÄÖÜ ß\tx\n')).toBe('bueromaterialaeoeuessx');
    const long = 'Verwendungszweck '.repeat(5);
    expect(normalizeText(long)).toHaveLength('verwendungszweck'.length * 5);
  });
});

describe('ruleMatches', () => {
  it('never matches without any condition', () => {
    expect(matches({})).toBe(false);
  });

  it('matches by account', () => {
    expect(matches({ accountId: 'A1' })).toBe(true);
    expect(matches({ accountId: 'A2' })).toBe(false);
  });

  it('matches by direction: in is money coming in, out is money going out', () => {
    expect(matches({ direction: 'out' })).toBe(true);
    expect(matches({ direction: 'in' })).toBe(false);
    expect(matches({ direction: 'in' }, { amountCents: 100 })).toBe(true);
    expect(matches({ direction: 'out' }, { amountCents: 100 })).toBe(false);
  });

  it('matches the iban normalized — whitespace and case do not matter; a transaction without iban never matches', () => {
    expect(matches({ counterpartyIban: 'de66 9999 9999 1234 5678 90' })).toBe(true);
    expect(matches({ counterpartyIban: 'DE66999999991234567890' }, { counterpartyIban: 'de66 9999 9999 1234 5678 90' })).toBe(true);
    expect(matches({ counterpartyIban: 'DE23999999990000202051' })).toBe(false);
    expect(matches({ counterpartyIban: 'DE66999999991234567890' }, { counterpartyIban: null })).toBe(false);
  });

  it('matches a text part in counterparty and purpose, ignoring case, umlauts and whitespace', () => {
    expect(matches({ textContains: 'bueromaterial' })).toBe(true);
    expect(matches({ textContains: 'Büro Material' })).toBe(true);
    expect(matches({ textContains: 'MÜLLER' })).toBe(true);
    // Über die Grenze zwischen Name und Zweck hinweg: beide stehen hintereinander.
    expect(matches({ textContains: 'muellerrechnung' })).toBe(true);
    expect(matches({ textContains: 'druckerpatronen' })).toBe(false);
    expect(matches({ textContains: 'bueromaterial' }, { counterpartyName: null })).toBe(true);
  });

  it('matches the absolute amount against a range, both ends inclusive and each optional', () => {
    expect(matches({ amountMinCents: 2499 })).toBe(true);
    expect(matches({ amountMinCents: 2500 })).toBe(false);
    expect(matches({ amountMaxCents: 2499 })).toBe(true);
    expect(matches({ amountMaxCents: 2498 })).toBe(false);
    expect(matches({ amountMinCents: 1000, amountMaxCents: 3000 })).toBe(true);
    expect(matches({ amountMinCents: 1000, amountMaxCents: 3000 }, { amountCents: 3001 })).toBe(false);
  });

  it('needs every set condition to match', () => {
    expect(matches({ accountId: 'A1', direction: 'out', textContains: 'bueromaterial', amountMaxCents: 5000 })).toBe(true);
    expect(matches({ accountId: 'A1', direction: 'in', textContains: 'bueromaterial', amountMaxCents: 5000 })).toBe(false);
    expect(matches({ accountId: 'A1', direction: 'out', textContains: 'bueromaterial', amountMaxCents: 1000 })).toBe(false);
  });
});
