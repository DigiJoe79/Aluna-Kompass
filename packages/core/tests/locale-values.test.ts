import { describe, expect, it } from 'vitest';
import { countLocale, stripLocale } from '../src/i18n/values';

const locales = ['de', 'en'];

describe('stripLocale', () => {
  it('removes the locale from a plain localized object', () => {
    expect(stripLocale({ de: 'Hallo', en: 'Hello' }, 'en', locales)).toEqual({ de: 'Hallo' });
  });

  it('reaches into nested objects and arrays', () => {
    const blocks = [{ id: 'b1', title: { de: 'A', en: 'B' }, href: '', label: { de: '', en: 'L' } }];
    expect(stripLocale(blocks, 'en', locales)).toEqual([{ id: 'b1', title: { de: 'A' }, href: '', label: { de: '' } }]);
  });

  it('handles localized lists, where each locale holds an array', () => {
    expect(stripLocale({ de: ['ruhig'], en: ['calm'] }, 'en', locales)).toEqual({ de: ['ruhig'] });
  });

  it('leaves objects alone whose keys are not all configured locales', () => {
    const record = { id: 'ABC', en: 'x' };
    expect(stripLocale(record, 'en', locales)).toEqual(record);
    const manifest = { 'index.html': 'abc', 'en/index.html': 'def' };
    expect(stripLocale(manifest, 'en', locales)).toEqual(manifest);
  });

  it('returns the same value when nothing matches, so a write can be skipped', () => {
    const value = { de: 'A' };
    expect(stripLocale(value, 'en', locales)).toBe(value);
    expect(stripLocale('plain', 'en', locales)).toBe('plain');
    expect(stripLocale(null, 'en', locales)).toBe(null);
  });
});

describe('countLocale', () => {
  it('counts every place the locale holds content', () => {
    expect(countLocale({ de: 'A', en: 'B' }, 'en', locales)).toBe(1);
    expect(countLocale({ de: 'A', en: '' }, 'en', locales)).toBe(0);
    expect(countLocale([{ title: { de: 'A', en: 'B' } }, { title: { de: 'C', en: 'D' } }], 'en', locales)).toBe(2);
    expect(countLocale({ de: ['x'], en: [] }, 'en', locales)).toBe(0);
    expect(countLocale({ de: ['x'], en: ['y'] }, 'en', locales)).toBe(1);
  });
});
