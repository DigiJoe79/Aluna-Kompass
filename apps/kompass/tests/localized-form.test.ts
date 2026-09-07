import { describe, expect, it } from 'vitest';
import { gapCount, jsonFromForm, localizedFromForm } from '@/lib/localized-form';

describe('localized form helpers', () => {
  it('reads de/en pairs and trims', () => {
    const fd = new FormData();
    fd.set('title.de', ' Hallo ');
    fd.set('title.en', '');
    expect(localizedFromForm(fd, 'title')).toEqual({ de: 'Hallo', en: '' });
    expect(localizedFromForm(fd, 'missing')).toEqual({ de: '', en: '' });
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
