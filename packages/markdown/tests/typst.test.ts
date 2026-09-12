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

  it('wraps each karten card in its own typst content block', async () => {
    const out = await renderMarkdownTypst(':::karten\n### Karte A\n\nText A\n\n### Karte B\n\nText B\n:::');
    // Ohne eigene Inhaltsblöcke stünde die Überschrift als Ausdruck im Argument — Typst bricht ab.
    expect(out).toContain('#grid(columns: 2, gutter: 1em,');
    expect(out).toContain('[\n=== Karte A');
    expect(out).toContain('[\n=== Karte B');
    expect(out).not.toMatch(/,\s*===/);
  });

  it('keeps text before the first card instead of dropping it', async () => {
    const out = await renderMarkdownTypst(':::karten\nVorspann.\n\n### Karte A\n\nText A\n:::');
    expect(out).toContain('Vorspann.');
  });

  it('renders a karten block without headings as plain content, not an empty grid', async () => {
    const out = await renderMarkdownTypst(':::karten\nNur Fließtext.\n:::');
    expect(out).toContain('Nur Fließtext.');
    expect(out).not.toContain('#grid(');
  });

  it('escapes characters typst reads as markup at the start of a line', async () => {
    const out = await renderMarkdownTypst('Guten Tag,\n\n= Umsatz 2026 ist das Thema.\n\n\\- kein Listenpunkt\n\n\\+ auch keiner');
    expect(out).toContain('\\= Umsatz');
    expect(out).toContain('\\- kein Listenpunkt');
    expect(out).toContain('\\+ auch keiner');
  });

  it('escapes a number that would start a typst enumeration', async () => {
    const out = await renderMarkdownTypst('Wir schreiben\n2026. Ein gutes Jahr.');
    expect(out).toContain('2026\\. Ein gutes Jahr.');
  });

  it('escapes slashes so typst does not read them as a comment or a term list', async () => {
    const out = await renderMarkdownTypst('und/oder // keine Notiz\n\n/ Begriff: Erklärung');
    expect(out).toContain('und\\/oder \\/\\/ keine Notiz');
    expect(out).toContain('\\/ Begriff');
    expect(out).not.toMatch(/(^|[^\\])\/\//);
  });
});
