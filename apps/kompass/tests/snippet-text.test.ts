import { describe, expect, it } from 'vitest';
import { splitSnippet } from '@/components/snippet-text';

const START = '\u0001';
const END = '\u0002';

describe('splitSnippet', () => {
  it('trennt markierte von unmarkierten Stücken', () => {
    expect(splitSnippet(`vom 14. ${START}Oktober${END} 2026`)).toEqual([
      { text: 'vom 14. ', marked: false },
      { text: 'Oktober', marked: true },
      { text: ' 2026', marked: false },
    ]);
  });

  it('kommt mit mehreren Markierungen zurecht', () => {
    const parts = splitSnippet(`${START}Praxis${END} Dr. ${START}Sommer${END}`);

    expect(parts.filter((p) => p.marked).map((p) => p.text)).toEqual(['Praxis', 'Sommer']);
  });

  it('lässt Text ohne Markierung unangetastet', () => {
    expect(splitSnippet('nichts markiert')).toEqual([{ text: 'nichts markiert', marked: false }]);
  });

  it('behält HTML-Tags im Text als reinen Text bei', () => {
    const parts = splitSnippet(`<script>alert(1)</script> ${START}Rechnung${END}`);
    expect(parts[0]).toEqual({ text: '<script>alert(1)</script> ', marked: false });
    expect(parts[1]).toEqual({ text: 'Rechnung', marked: true });
  });

  it('behandelt unvollständige Markierungen tolerant', () => {
    expect(splitSnippet(`vor ${START}abgebrochen`)).toEqual([
      { text: 'vor ', marked: false },
      { text: 'abgebrochen', marked: false },
    ]);
  });
});
