import { describe, expect, it } from 'vitest';
import { allowlistHygiene, checkCountedAllowlist, type CountedAllowlist, openingTags, read, relative, sourceFiles } from './source';

/**
 * Ein Schalter steht rechts von seinem Text, ein Haken links (docs/MUSTER.md § J, Runde 3, 174) — wie in den
 * Einstellungszeilen (Steuerliches, Module). `FormField toggle` ordnet das selbst (Test `tests/form-field.test.tsx`);
 * dieser Wächter findet eigene Zeilen, in denen ein `<Switch … />` direkt vor seinem `<Label>` bzw. `<label>` steht.
 */
export const ALLOWED: CountedAllowlist = {};

/** Zeilen, in denen ein selbstschließender `<Switch … />` direkt vor einem Label steht. */
export function switchBeforeLabel(text: string): number[] {
  return openingTags(text, /Switch/)
    .filter(({ tag }) => tag.endsWith('/>'))
    .filter(({ tag }) => {
      const after = text.slice(text.indexOf(tag) + tag.length);
      return /^\s*<(Label|label)\b/.test(after);
    })
    .map(({ line }) => line);
}

describe('Schalter rechts vom Text (174)', () => {
  it('erkennt Schalter vor dem Label', () => {
    expect(switchBeforeLabel('<div>\n  <Switch id="a" onCheckedChange={(v) => set(v)} />\n  <Label htmlFor="a">A</Label>\n</div>')).toEqual([2]);
    expect(switchBeforeLabel('<div>\n  <Label htmlFor="a">A</Label>\n  <Switch id="a" />\n</div>')).toEqual([]);
  });

  const hits = sourceFiles().flatMap((file) => switchBeforeLabel(read(file)).map((line) => ({ where: `${relative(file)}:${line}`, file: relative(file) })));

  it('kein Schalter links von seinem Label außerhalb der Erlaubnisliste', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => checkCountedAllowlist(hits, ALLOWED).stale);
});
