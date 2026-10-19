import { describe, expect, it } from 'vitest';
import { matchesSearch, normalizeForSearch } from '@/lib/normalize-for-search';

describe('normalizeForSearch', () => {
  it('folds case, umlauts, their spelled-out forms and ß/ss to one key', () => {
    expect(normalizeForSearch('Wießner')).toBe(normalizeForSearch('wiesner'));
    expect(normalizeForSearch('Wießner')).toBe(normalizeForSearch('WIESSNER'));
    expect(normalizeForSearch('Müller')).toBe(normalizeForSearch('mueller'));
    expect(normalizeForSearch('Müller')).toBe(normalizeForSearch('muller'));
    expect(normalizeForSearch('Bäcker')).toBe(normalizeForSearch('baecker'));
    expect(normalizeForSearch('Göbel')).toBe(normalizeForSearch('goebel'));
    expect(normalizeForSearch('Renée')).toBe(normalizeForSearch('renee'));
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeForSearch('  Beitrag   2026 ')).toBe('beitrag 2026');
  });
});

describe('matchesSearch', () => {
  it('matches when every word of the query occurs in one of the texts', () => {
    expect(matchesSearch('wiesner', ['Beitrag 2026 Mitglied 0001', 'Ida Wießner'])).toBe(true);
    expect(matchesSearch('beitrag wiesner', ['Beitrag 2026 Mitglied 0001', 'Ida Wießner'])).toBe(true);
    expect(matchesSearch('beitrag huber', ['Beitrag 2026 Mitglied 0001', 'Ida Wießner'])).toBe(false);
  });

  it('matches everything for an empty query and ignores missing texts', () => {
    expect(matchesSearch('  ', ['x'])).toBe(true);
    expect(matchesSearch('wiesner', ['Beitrag', null])).toBe(false);
  });
});
