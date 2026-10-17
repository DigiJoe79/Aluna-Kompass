import { describe, expect, it } from 'vitest';
import { isCommentLine, openingTags, read, relative, sourceFiles, SRC } from './source';

/**
 * Erledigt ist in jeder `RequirementList` ein Haken, keine Marke (docs/MUSTER.md § F, Runde 3, 166): Ein Zustand hat
 * eine Form — offen ein Kreis, erledigt ein Haken mit gedämpftem Titel; das Wort „Erledigt“ (`doneLabel`) steht nur
 * für Vorleser. Geprüft wird der Baustein selbst (`doneLabel` nur in `sr-only` oder `aria-label`) und jede Datei, die
 * eine `RequirementList` zeigt (keine `StatusBadge`, deren Inhalt „erledigt“ bzw. einen `done`-Text nennt).
 * Komponententest: `tests/requirement-list.test.tsx`.
 */
const COMPONENT = `${SRC}/components/requirement-list.tsx`;
const DONE = /\bdone\w*\b|erledigt/i;

/** Der Inhalt jeder `<StatusBadge …>…</StatusBadge>` mit Zeile — ohne die Props im öffnenden Tag. */
export function badgeContents(text: string): { line: number; content: string }[] {
  return openingTags(text, /StatusBadge/).flatMap(({ line, tag }) => {
    if (tag.endsWith('/>')) return [];
    const start = text.indexOf(tag) + tag.length;
    const end = text.indexOf('</StatusBadge>', start);
    return end === -1 ? [] : [{ line, content: text.slice(start, end) }];
  });
}

describe('RequirementList: erledigt als Haken (166)', () => {
  it('erkennt eine Marke mit Erledigt-Text', () => {
    expect(badgeContents('<StatusBadge tone="success">{item.doneLabel}</StatusBadge>').map(({ content }) => DONE.test(content))).toEqual([true]);
    expect(badgeContents('<StatusBadge tone="warning">{item.actionLabel}</StatusBadge>').map(({ content }) => DONE.test(content))).toEqual([false]);
  });

  it('der Baustein nennt `doneLabel` nur für Vorleser', () => {
    const text = read(COMPONENT);
    const visible = text
      .split('\n')
      .flatMap((line, index) =>
        /item\.doneLabel/.test(line) && !isCommentLine(line) && !/sr-only|aria-label=\{item\.doneLabel\}/.test(line) ? [`${relative(COMPONENT)}:${index + 1}`] : [],
      );
    expect(visible).toEqual([]);
  });

  it('keine Marke „Erledigt“ in einer Datei mit RequirementList', () => {
    const hits = sourceFiles()
      .filter((file) => /<RequirementList\b/.test(read(file)) || file === COMPONENT)
      .flatMap((file) =>
        badgeContents(read(file))
          .filter(({ content }) => DONE.test(content))
          .map(({ line }) => `${relative(file)}:${line}`),
      );
    expect(hits).toEqual([]);
  });
});
