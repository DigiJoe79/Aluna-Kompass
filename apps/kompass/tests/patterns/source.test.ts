import { describe, expect, it } from 'vitest';
import { callArguments, isCommentLine, lineOf, openingTags } from './source';

describe('Hilfe der Wächter', () => {
  it('findet einen Tag über mehrere Zeilen und meldet seine Zeile', () => {
    const text = `const a = 1;\n<TableRow\n  key={x}\n  onClick={() => go(x)}\n  className="a > b"\n>\n  <TableCell />\n</TableRow>`;
    const tags = openingTags(text, /TableRow/);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.line).toBe(2);
    expect(tags[0]!.tag).toContain('onClick');
    expect(tags[0]!.tag).toContain('className="a > b"');
    expect(tags[0]!.tag).not.toContain('TableCell');
  });
  it('verwechselt <tr nicht mit <track', () => {
    expect(openingTags('<track src="x" /><tr className="y">', /tr/)).toHaveLength(1);
  });
  it('liest die Argumente eines Aufrufs bis zur passenden Klammer', () => {
    const calls = callArguments(`x();\ntoast.error(fn(a.message), { b: 1 });\ny();`, 'toast.error(');
    expect(calls).toEqual([{ line: 2, args: 'fn(a.message), { b: 1 }' }]);
  });
  it('kennt Zeilennummern und Kommentarzeilen', () => {
    expect(lineOf('a\nb\nc', 4)).toBe(3);
    expect(isCommentLine('  * erklärt ?panel=')).toBe(true);
    expect(isCommentLine('  const x = 1;')).toBe(false);
  });
});
