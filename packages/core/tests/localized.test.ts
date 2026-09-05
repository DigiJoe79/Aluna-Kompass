import { describe, expect, it } from 'vitest';
import { emptyLocalized, LOCALES, localizedText, resolveText, translationGaps } from '../src/i18n/localized';

describe('localized text', () => {
  it('defines de and en with de as default', () => {
    expect(LOCALES).toEqual(['de', 'en']);
  });

  it('parses, trims and fills missing en with an empty string', () => {
    const schema = localizedText({ required: true, max: 20 });
    expect(schema.parse({ de: ' Hallo ', en: ' Hello ' })).toEqual({ de: 'Hallo', en: 'Hello' });
    expect(schema.parse({ de: 'Hallo' })).toEqual({ de: 'Hallo', en: '' });
    expect(schema.safeParse({ de: '', en: 'x' }).success).toBe(false);
    expect(schema.safeParse({ de: 'x'.repeat(21), en: '' }).success).toBe(false);
    expect(localizedText().safeParse({ de: '', en: '' }).success).toBe(true);
  });

  it('resolves with fallback marker', () => {
    expect(resolveText({ de: 'Hund', en: 'Dog' }, 'en')).toEqual({ value: 'Dog', fallback: null });
    expect(resolveText({ de: 'Hund', en: '' }, 'en')).toEqual({ value: 'Hund', fallback: 'de' });
    expect(resolveText({ de: 'Hund', en: '' }, 'de')).toEqual({ value: 'Hund', fallback: null });
  });

  it('lists fields whose en is missing while de is filled', () => {
    const record = { title: { de: 'A', en: '' }, lede: { de: 'B', en: 'C' }, body: { de: '', en: '' }, other: 5 };
    expect(translationGaps(record, ['title', 'lede', 'body'])).toEqual(['title']);
    expect(emptyLocalized()).toEqual({ de: '', en: '' });
  });
});
