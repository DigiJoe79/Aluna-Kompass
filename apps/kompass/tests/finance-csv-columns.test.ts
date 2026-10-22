import { describe, expect, it } from 'vitest';
import type { AssistantState, ColumnRole } from '@/lib/finance/csv-assistant-state';
import { breakableParts, duplicateRoleIndices, entryGroups, matchesColumn, requiredChecks, sampleValues } from '@/lib/finance/csv-columns';

/** Schritt 3 des CSV-Assistenten als Liste (Spec 2026-10-22): reine Logik ohne DOM. */
const state = (roles: ColumnRole[], over: Partial<AssistantState> = {}): AssistantState => ({
  step: 3,
  settings: { encoding: 'utf-8', delimiter: ';', headerRow: 0, dateFormat: 'DD.MM.YYYY', decimalSeparator: ',' },
  roles,
  guessed: roles.map(() => false),
  indicatorValues: '',
  pendingValues: '',
  invertSign: null,
  name: 'X',
  ...over,
});

describe('requiredChecks', () => {
  const header = ['Datum', 'Name', 'Betrag', 'Status'];
  const roles: ColumnRole[] = ['bookingDate', 'counterpartyName', 'amount', 'pending'];

  it('the three core items always, status values only with a status column', () => {
    expect(requiredChecks(header, state(roles))).toEqual([
      { key: 'bookingDate', done: true, columns: ['Datum'] },
      { key: 'amount', done: true, columns: ['Betrag'] },
      { key: 'nameOrPurpose', done: true, columns: ['Name'] },
      { key: 'pendingValues', done: false, columns: ['Status'] },
    ]);
    expect(requiredChecks(header, state(roles, { pendingValues: 'Ausstehend' })).at(-1)).toEqual({ key: 'pendingValues', done: true, columns: ['Status'] });
    expect(requiredChecks(header, state(['ignore', 'ignore', 'ignore', 'indicator'])).map((c) => [c.key, c.done])).toEqual([
      ['bookingDate', false],
      ['amount', false],
      ['nameOrPurpose', false],
      ['indicatorValues', false],
    ]);
  });

  it('amount: one signed column or debit and credit, like buildFormat', () => {
    const amountOf = (r: ColumnRole[]) => requiredChecks(header, state(r)).find((c) => c.key === 'amount')!;
    expect(amountOf(['bookingDate', 'debit', 'ignore', 'ignore']).done).toBe(false);
    expect(amountOf(['bookingDate', 'debit', 'credit', 'ignore'])).toEqual({ key: 'amount', done: true, columns: ['Name', 'Betrag'] });
    expect(amountOf(['bookingDate', 'amount', 'debit', 'ignore']).done).toBe(false);
  });
});

describe('duplicateRoleIndices', () => {
  it('every index whose role occurs twice; ignore never counts', () => {
    expect(duplicateRoleIndices(['purpose', 'ignore', 'purpose', 'amount'])).toEqual(new Set([0, 2]));
    expect(duplicateRoleIndices(['ignore', 'ignore', 'amount'])).toEqual(new Set());
  });
});

describe('sampleValues', () => {
  it('distinct non-empty values in order of first appearance, at most max', () => {
    expect(sampleValues([['a'], [''], ['a'], ['b'], ['c']], 0, 2)).toEqual(['a', 'b']);
    expect(sampleValues([[''], ['  '], []], 0, 2)).toEqual([]);
  });
});

describe('entryGroups', () => {
  it('indices with and without a role', () => {
    expect(entryGroups(['ignore', 'amount', 'ignore'])).toEqual({ withRole: [1], more: [0, 2] });
  });
});

describe('matchesColumn', () => {
  const header = ['Gebühr', 'Code'];
  const rows = [['0,10', 'zd7a-1'], ['0,00', 'XY']];
  it('searches name and values, case-insensitive; empty query matches', () => {
    expect(matchesColumn(header, rows, 0, ' gebühr ')).toBe(true);
    expect(matchesColumn(header, rows, 1, 'ZD7A')).toBe(true);
    expect(matchesColumn(header, rows, 0, 'ZD7A')).toBe(false);
    expect(matchesColumn(header, rows, 1, '')).toBe(true);
  });
});

describe('breakableParts', () => {
  it('splits e-mail addresses after @ and ., other values stay whole', () => {
    expect(breakableParts('erika.beispiel@example.org')).toEqual(['erika.', 'beispiel@', 'example.', 'org']);
    expect(breakableParts('a.b@c.de')).toEqual(['a.', 'b@', 'c.', 'de']);
    expect(breakableParts('Spende März')).toEqual(['Spende März']);
  });
});
