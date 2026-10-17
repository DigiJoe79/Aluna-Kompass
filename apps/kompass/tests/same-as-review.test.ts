import { describe, expect, it } from 'vitest';
import { blankValue } from '@/app/(shell)/animals/proposals/[id]/same-as-review';

/** 054: Zeilen der Zuordnung, die auf beiden Seiten leer sind, sagen nichts und fallen weg. */
describe('blankValue', () => {
  it('treats null, empty text, empty lists and records without text as empty', () => {
    for (const v of [null, undefined, '', '  ', [], {}, { de: '', en: ' ' }]) expect(blankValue(v)).toBe(true);
  });
  it('keeps values that say something, also false and 0', () => {
    for (const v of ['Rüde', 0, false, ['a'], { de: 'Text' }]) expect(blankValue(v)).toBe(false);
  });
});
