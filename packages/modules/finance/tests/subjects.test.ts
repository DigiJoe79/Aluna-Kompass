import { describe, expect, it } from 'vitest';
import { expenseReceiptSubject, reserveResolutionSubject, transferResolutionSubject, ULID_PATTERN } from '../src/allocation/subjects';

describe('reserveResolutionSubject', () => {
  it('names the reserve, not its id', () => {
    expect(reserveResolutionSubject('resolution', 'Tierarztkosten 2027')).toBe('Beschluss für zurückgelegtes Geld „Tierarztkosten 2027“');
    expect(reserveResolutionSubject('carryForward', 'Tierarztkosten 2027')).toBe('Beschluss zum Vortrag von zurückgelegtem Geld „Tierarztkosten 2027“');
    expect(reserveResolutionSubject('movement', 'Tierarztkosten 2027')).toBe('Beschluss für einen Vorgang an zurückgelegtem Geld „Tierarztkosten 2027“');
  });

  it('keeps quotes in the name readable', () => {
    expect(reserveResolutionSubject('resolution', 'Rücklage „Neubau“')).toBe('Beschluss für zurückgelegtes Geld „Rücklage „Neubau““');
  });
});

describe('transferResolutionSubject', () => {
  it('names both purposes and calls a missing one free funds', () => {
    expect(transferResolutionSubject('Kastration', 'Futter')).toBe('Beschluss für Umwidmung von „Kastration“ zu „Futter“');
    expect(transferResolutionSubject(null, 'Futter')).toBe('Beschluss für Umwidmung von freien Mitteln zu „Futter“');
    expect(transferResolutionSubject('Kastration', null)).toBe('Beschluss für Umwidmung von „Kastration“ zu freien Mitteln');
  });

  it('stays within 300 characters for two long names', () => {
    const subject = transferResolutionSubject('a'.repeat(120), 'b'.repeat(120));
    expect(subject.length).toBeLessThanOrEqual(300);
    const longer = transferResolutionSubject('a'.repeat(200), 'b'.repeat(200));
    expect(longer).toHaveLength(300);
    expect(longer.endsWith('…')).toBe(true);
  });
});

describe('expenseReceiptSubject', () => {
  it('uses the claim number when there is one', () => {
    expect(expenseReceiptSubject({ claimNumber: 'KE-2026-001', positionDate: '2026-08-20', today: '2026-10-06', position: 2 })).toBe('Beleg zu Auslage KE-2026-001 · Position 2');
  });

  it('uses the position date for a draft, else today — never an id', () => {
    expect(expenseReceiptSubject({ claimNumber: null, positionDate: '2026-08-20', today: '2026-10-06', position: 2 })).toBe('Beleg zu Auslage vom 20.08.2026 · Position 2');
    expect(expenseReceiptSubject({ claimNumber: null, positionDate: null, today: '2026-10-06', position: 1 })).toBe('Beleg zu Auslage vom 06.10.2026 · Position 1');
  });
});

describe('ULID_PATTERN', () => {
  it('finds a ulid and nothing else', () => {
    expect(ULID_PATTERN.test('Beleg zu Auslage 01M3YQF4WKHMH25QGDTHTGQVSA')).toBe(true);
    expect(ULID_PATTERN.test('Beleg zu Auslage KE-2026-001 · Position 2')).toBe(false);
  });
});
