import { describe, expect, it } from 'vitest';
import { renderMarkdownTypst } from '../src/typst';

describe('renderMarkdownTypst', () => {
  it('maps block elements to typst', async () => {
    const out = await renderMarkdownTypst('# Titel\n\nText mit **fett** und _kursiv_.\n\n- a\n- b\n\n> Hinweis\n\n---');
    expect(out).toContain('= Titel');
    expect(out).toContain('*fett*');
    expect(out).toContain('_kursiv_');
    expect(out).toContain('- a');
    expect(out).toContain('#quote(block: true)[');
    expect(out).toContain('#line(length: 100%');
  });

  it('renders a gfm table', async () => {
    const out = await renderMarkdownTypst('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(out).toContain('#table(');
    expect(out).toContain('columns: 2');
  });

  it('escapes typst-special characters in text so user content cannot inject', async () => {
    const out = await renderMarkdownTypst('Preis #panic("x") [box] $x^2$ @label ~');
    // Jedes Sonderzeichen trägt einen Backslash davor — kein unmaskiertes `#`, `[`, `$`, `@`.
    expect(out).not.toMatch(/(^|[^\\])#panic/);
    expect(out).toContain('\\#panic');
    expect(out).toContain('\\[box\\]');
    expect(out).toContain('\\$x^2\\$');
    expect(out).toContain('\\@label');
  });

  it('is deterministic', async () => {
    const md = '## Abschnitt\n\nEin Absatz mit [Link](https://example.org).';
    expect(await renderMarkdownTypst(md)).toBe(await renderMarkdownTypst(md));
  });

  it('returns empty string for blank input', async () => {
    expect(await renderMarkdownTypst('   \n')).toBe('');
  });
});
