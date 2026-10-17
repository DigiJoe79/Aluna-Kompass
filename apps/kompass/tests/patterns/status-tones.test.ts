import { describe, expect, it } from 'vitest';
import { matchingLines, read, relative, sourceFiles } from './source';

/**
 * Eine Tontabelle Status → Ton (Designer Stufe 2 Nr. 6f, MUSTER § F): `STATUS_TONES` in `components/status-badge.tsx`.
 * Bis 0.2.11 hatten sieben Stellen eigene Tabellen (Bestandsaufnahme B.7), und derselbe Zustand trug je Liste einen
 * anderen Ton. Verboten außerhalb des Bausteins: eine Tabelle mit `BadgeTone` als Wert, eine Union aus Tönen als
 * Wert eines `Record`, ein Objekt mit zwei Tönen nebeneinander.
 */
const TONE = `'(?:success|warning|error|info|neutral|brand|accent|final|agent)'`;
const LOCAL_TABLE = new RegExp(
  [
    String.raw`Record<[^>]*,\s*BadgeTone\s*>`,
    String.raw`Record<[^>]*,\s*${TONE}(?:\s*\|\s*${TONE})+\s*>`,
    String.raw`[\w'"]+\s*:\s*${TONE}\s*,\s*[\w'"]+\s*:\s*${TONE}`,
  ].join('|'),
);

const OWNER = 'components/status-badge.tsx';

export function localToneTables(): string[] {
  return sourceFiles().flatMap((file) => (relative(file) === OWNER ? [] : matchingLines(file, read(file), LOCAL_TABLE)));
}

describe('Heuristik', () => {
  it('trifft lokale Tabellen', () => {
    for (const hit of [
      "const TONE: Record<State, BadgeTone> = { a: 'x' };",
      "const T: Record<K, 'warning' | 'info'> = {};",
      "const tone = { ui: 'info', mcp: 'accent', system: 'neutral' } as const;",
    ])
      expect(LOCAL_TABLE.test(hit), hit).toBe(true);
  });
  it('lässt einzelne Töne und Ternaries stehen', () => {
    for (const miss of ["{ tone: 'agent' }", "tone={ok ? 'success' : 'neutral'}", "statusTone('claim', key)"]) expect(LOCAL_TABLE.test(miss), miss).toBe(false);
  });
});

describe('Tontabelle nur in StatusBadge', () => {
  it('keine lokalen Tontabellen', () => {
    expect(localToneTables()).toEqual([]);
  });
});
