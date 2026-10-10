import { describe, expect, it } from 'vitest';
import { changedPlaces, diffExcerpt, wordDiff } from '@/lib/word-diff';

describe('wordDiff', () => {
  it('keeps unchanged words and marks insertions and deletions by word', () => {
    expect(wordDiff('Er läuft noch unsicher an der Leine', 'Er läuft inzwischen gut an der Leine')).toEqual([
      { kind: 'same', text: 'Er läuft ' },
      { kind: 'removed', text: 'noch unsicher' },
      { kind: 'added', text: 'inzwischen gut' },
      { kind: 'same', text: ' an der Leine' },
    ]);
  });
  it('treats equal texts as one unchanged part and empty as nothing', () => {
    expect(wordDiff('a b', 'a b')).toEqual([{ kind: 'same', text: 'a b' }]);
    expect(wordDiff('', 'neu')).toEqual([{ kind: 'added', text: 'neu' }]);
    expect(wordDiff('', '')).toEqual([]);
  });
  it('counts changed places, not words', () => expect(changedPlaces(wordDiff('a b c d', 'a x c y'))).toBe(2));
  it('shortens long unchanged stretches to context with gaps', () => {
    const same = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
    const parts = diffExcerpt(wordDiff(`${same} alt ${same}`, `${same} neu ${same}`), 3);
    expect(parts[0]).toEqual({ kind: 'gap' });
    expect(parts.at(-1)).toEqual({ kind: 'gap' });
    expect(parts.filter((p) => p.kind === 'added')).toEqual([{ kind: 'added', text: 'neu' }]);
    expect(parts.filter((p) => p.kind === 'same').map((p) => (p as { text: string }).text.trim().split(/\s+/).length)).toEqual([3, 3]);
  });
  it('falls back to replacing everything above the size limit', () => {
    const big = 'x '.repeat(3000);
    expect(wordDiff(big, `${big}y`).map((p) => p.kind)).toEqual(['removed', 'added']);
  });
});
