import { describe, expect, it } from 'vitest';
import { isProductSource, lineHits, messageTexts, sourceFiles, SRC } from './source';

/**
 * „§ 13b“ bricht nie um (Designer Runde 8, Vorweg 1): Nach „§“ und „§§“ steht ein geschütztes Leerzeichen — in der
 * Sprachdatei als ` `, im PDF über die Show-Regel im Einstieg des Renderers (`packages/documents/src/renderer.ts`),
 * in Texten der Fachmodule, die die Oberfläche direkt zeigt, über `keepSectionSign` (`@kompass/module-finance/format`).
 * Vorher stand „(§“ am Zeilenende und „13b“ in der nächsten Zeile (341, 342, 345, 043, 093/094).
 */
const SPLIT = /§+ /;
/** Ein Text in Anführungszeichen, der „§ “ enthält — Kommentare zählt `lineHits` nicht. */
const literal = (line: string): boolean => /(['"`])(?:(?!\1).)*§+ (?:(?!\1).)*\1/.test(line.replace(/\s\/\/ .*$/, '').replace(/\/\*.*?(\*\/|$)/g, ''));

describe('Heuristik', () => {
  it('trifft „§ “ in einem Text, nicht im Kommentar und nicht mit geschütztem Leerzeichen', () => {
    expect(literal("label: 'nach § 13b'")).toBe(true);
    expect(literal("label: 'nach §\\u00a013b'")).toBe(false);
    expect(literal('x(); // MUSTER § G')).toBe(false);
    expect(literal('{/* Satz (`p`, MUSTER § G) */}')).toBe(false);
  });
});

describe('Paragrafenzeichen mit geschütztem Leerzeichen', () => {
  it('die Sprachdatei', () => {
    expect(messageTexts().filter(([, text]) => SPLIT.test(text)).map(([key]) => key)).toEqual([]);
  });
  it('Texte im Quelltext der App', () => {
    expect(lineHits(sourceFiles(SRC).filter(isProductSource), literal).map((h) => h.where)).toEqual([]);
  });
});
