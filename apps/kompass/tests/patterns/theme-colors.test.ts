import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { isCommentLine, read, relative, SRC, sourceFiles } from './source';

/**
 * Nur Farben, die es im Theme gibt (Befund 0.2.8/12): `globals.css` setzt `--color-*: initial`, eine Klasse
 * wie `text-danger` erzeugt also kein CSS und fällt still durch — der Text steht ungefärbt da, und `cn` kann
 * eine unbekannte Farbe sogar als Größe lesen. Der Wächter liest die Tokens (`--color-…`, für `text-` auch die
 * Schriftrollen `--text-…`) aus `globals.css` und meldet jede Farbklasse, deren Wert weder Token noch
 * bekanntes Nicht-Farb-Utility ist. Beliebige Werte (`bg-[…]`) prüft er nicht.
 */
const CSS = read(path.join(SRC, 'app/globals.css'));
const tokens = (kind: 'color' | 'text') => new Set([...CSS.matchAll(new RegExp(`--${kind}-([a-z0-9-]+?)(?:--[a-z-]+)?:`, 'g'))].map((m) => m[1]!));
const COLORS = new Set([...tokens('color'), 'transparent', 'current', 'inherit']);

const SIZES = ['0', '1', '2', '4', '8'];
const ALIGN = ['left', 'center', 'right', 'justify', 'start', 'end'];
/** Was je Vorsilbe kein Farbname ist (Tailwind 4). */
const NOT_COLOR: Record<string, (value: string) => boolean> = {
  text: (v) => tokens('text').has(v) || /^(xs|sm|base|lg|[2-9]?xl)$/.test(v) || [...ALIGN, 'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip'].includes(v),
  bg: (v) => /^(fixed|local|scroll|clip-.+|origin-.+|no-repeat|repeat(-.+)?|cover|contain|auto|none|center|top|bottom|left|right|(left|right)-(top|bottom)|gradient-.+|linear-.+|radial(-.+)?|conic(-.+)?|blend-.+)$/.test(v),
  border: (v) => /^([xytrblse](-\d+)?|\d+|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing(-.+)?)$/.test(v),
  ring: (v) => SIZES.includes(v) || v === 'inset' || /^offset-.+$/.test(v),
  outline: (v) => SIZES.includes(v) || /^(none|hidden|solid|dashed|dotted|double|offset-.+)$/.test(v),
  fill: (v) => v === 'none',
  stroke: (v) => v === 'none' || /^\d+(\.\d+)?$/.test(v),
  decoration: (v) => SIZES.includes(v) || /^(solid|double|dotted|dashed|wavy|auto|from-font|clone|slice)$/.test(v),
  divide: (v) => /^([xy](-\d+)?|[xy]-reverse|solid|dashed|dotted|double|none)$/.test(v),
  from: (v) => /^\d+%$/.test(v),
  via: (v) => /^\d+%$/.test(v),
  to: (v) => /^\d+%$/.test(v),
  caret: () => false,
  accent: (v) => v === 'auto',
  placeholder: () => false,
};

const CLASS = new RegExp(`(?<![\\w\\-/.\\[])!?(${Object.keys(NOT_COLOR).join('|')})-([a-z][a-z0-9-]*?)(?:\\/[0-9]+)?(?![\\w\\-\\[(])`, 'g');

/** Wahr, wenn `prefix-value` eine Farbe nennt, die es nicht gibt. `border-t-brand` prüft `brand`. */
function unknown(prefix: string, value: string): boolean {
  const side = prefix === 'border' ? /^[xytrblse]-([a-z].*)$/.exec(value) : null;
  const v = side ? side[1]! : value;
  return !COLORS.has(v) && !NOT_COLOR[prefix]!(v);
}

/** Die unbekannten Farbklassen einer Zeile. */
const hits = (line: string) => [...line.matchAll(CLASS)].filter(([, prefix, value]) => unknown(prefix!, value!)).map(([match]) => match);

/** `datei:zeile klasse` für jede unbekannte Farbe. */
function unknownColors(file: string): string[] {
  return read(file)
    .split('\n')
    .flatMap((line, index) => (isCommentLine(line) ? [] : hits(line).map((match) => `${relative(file)}:${index + 1} ${match}`)));
}

describe('nur Theme-Farben', () => {
  it('liest die Tokens aus globals.css', () => {
    expect(COLORS.has('error')).toBe(true);
    expect(COLORS.has('danger')).toBe(false);
    expect(tokens('text').has('meta')).toBe(true);
  });

  it('erkennt eine unbekannte Farbe und lässt Größen, Rollen und Tokens stehen', () => {
    expect(hits('className="text-[13px] text-danger hover:bg-error-bg border-t border-line text-meta"')).toEqual(['text-danger']);
    expect(hits('className="ring-2 ring-focus/40 outline-none bg-surface-2 text-sm text-center"')).toEqual([]);
    expect(hits('className="border-t-2 border-t-brand border-l-transparent border-b-subtle"')).toEqual(['border-b-subtle']);
  });

  it('Klassen nennen nur Farben, die es gibt', () => {
    expect(sourceFiles().flatMap(unknownColors)).toEqual([]);
  });
});
