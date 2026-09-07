import { describe, expect, it } from 'vitest';
import { emptyLocalized, localizedText, resolveText, translationGaps } from '../src/i18n/localized';

describe('localized text', () => {
  it('parses and trims any locale key', () => {
    const schema = localizedText({ max: 20 });
    expect(schema.parse({ de: ' Hallo ', en: ' Hello ', fr: 'Bonjour' })).toEqual({ de: 'Hallo', en: 'Hello', fr: 'Bonjour' });
    expect(schema.safeParse({ de: 'x'.repeat(21) }).success).toBe(false);
    expect(schema.parse({})).toEqual({});
  });

  it('marks itself as localized so validate can find it', () => {
    expect(localizedText().meta()).toMatchObject({ localized: true });
  });

  it('resolves with the given fallback and reports it', () => {
    expect(resolveText({ de: 'Hund', en: 'Dog' }, 'en', 'de')).toEqual({ value: 'Dog', fallback: null });
    expect(resolveText({ de: 'Hund', en: '' }, 'en', 'de')).toEqual({ value: 'Hund', fallback: 'de' });
    expect(resolveText({ de: 'Hund' }, 'fr', 'de')).toEqual({ value: 'Hund', fallback: 'de' });
    expect(resolveText({}, 'de', 'de')).toEqual({ value: '', fallback: null });
  });

  it('lists fields that miss any locale beyond the leading one', () => {
    const record = { title: { de: 'A', en: '' }, lede: { de: 'B', en: 'C' }, body: { de: '', en: '' }, other: 5 };
    expect(translationGaps(record, ['title', 'lede', 'body'], ['de', 'en'])).toEqual(['title']);
    expect(translationGaps(record, ['title', 'lede'], ['de'])).toEqual([]);
    expect(emptyLocalized(['de', 'fr'])).toEqual({ de: '', fr: '' });
  });
});
