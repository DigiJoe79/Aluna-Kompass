import { describe, expect, it } from 'vitest';
import { readPath, splitPath, writePath } from '../src/i18n/paths';

describe('localized field paths', () => {
  it('splits dotted paths with indexes', () => {
    expect(splitPath('summary')).toEqual(['summary']);
    expect(splitPath('story.quote')).toEqual(['story', 'quote']);
    expect(splitPath('faq[2].answer')).toEqual(['faq', 2, 'answer']);
  });

  it('reads through objects and arrays, undefined when missing', () => {
    const root = { faq: [{ q: { de: 'A' } }, { q: { de: 'B' } }], story: null };
    expect(readPath(root, 'faq[1].q')).toEqual({ de: 'B' });
    expect(readPath(root, 'faq[5].q')).toBeUndefined();
    expect(readPath(root, 'story.quote')).toBeUndefined();
    expect(readPath(root, 'nope')).toBeUndefined();
  });

  it('writes a copy and leaves the input alone', () => {
    const root = { faq: [{ q: { de: 'A', en: '' } }], claim: { de: 'x' } };
    const next = writePath(root, 'faq[0].q', { de: 'A', en: 'A!' });
    expect(next).toEqual({ faq: [{ q: { de: 'A', en: 'A!' } }], claim: { de: 'x' } });
    expect(root.faq[0]!.q).toEqual({ de: 'A', en: '' });
    expect(next!.claim).toBe(root.claim);
  });

  it('refuses to invent nodes', () => {
    expect(writePath({ faq: [] }, 'faq[0].q', {})).toBeUndefined();
    expect(writePath({ a: 1 }, 'b', {})).toBeUndefined();
    expect(writePath({ a: { b: 1 } }, 'a.c', {})).toBeUndefined();
  });
});
