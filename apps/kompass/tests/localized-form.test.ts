import { describe, expect, it } from 'vitest';
import { gapCount, jsonFromForm, localizedFromForm } from '@/lib/localized-form';

describe('localized form helpers', () => {
  it('reads arbitrary locales and trims, missing locales become empty string', () => {
    const fd = new FormData();
    fd.set('title.de', ' Hallo ');
    fd.set('title.en', ' Hello ');
    fd.set('title.fr', '');
    expect(localizedFromForm(fd, 'title', ['de', 'en', 'fr'])).toEqual({ de: 'Hallo', en: 'Hello', fr: '' });
    expect(localizedFromForm(fd, 'missing', ['de', 'en', 'es'])).toEqual({ de: '', en: '', es: '' });
  });
  it('parses json lists with fallback', () => {
    const fd = new FormData();
    fd.set('blocks__json', JSON.stringify([{ id: 'a' }]));
    expect(jsonFromForm(fd, 'blocks', [])).toEqual([{ id: 'a' }]);
    expect(jsonFromForm(fd, 'nope', [1])).toEqual([1]);
    fd.set('broken__json', '{');
    expect(jsonFromForm(fd, 'broken', 'fallback')).toBe('fallback');
  });
  it('counts translation gaps', () => {
    expect(gapCount({ title: { de: 'A', en: '' }, lede: { de: 'B', en: 'C' }, body: { de: '', en: '' } }, ['title', 'lede', 'body'], ['de', 'en'])).toBe(1);
  });
});
