import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src';

describe('renderMarkdown', () => {
  it('renders paragraphs, headings with emphasis, lists and links', async () => {
    const html = await renderMarkdown('# Jeder Hund verdient ein *Zuhause.*\n\nErster Absatz mit **fett**.\n\n- eins\n- zwei\n\n[Satzung](/satzung/) und [extern](https://example.org)');
    expect(html).toContain('<h1>Jeder Hund verdient ein <em>Zuhause.</em></h1>');
    expect(html).toContain('<strong>fett</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<a href="/satzung/">Satzung</a>');
    expect(html).toContain('<a href="https://example.org" rel="noopener">extern</a>');
  });

  it('turns blockquotes into note boxes', async () => {
    const html = await renderMarkdown('> Für den Auslandstierschutz ist eine Erlaubnis nötig.');
    expect(html).toContain('<aside class="note">\n<p>Für den Auslandstierschutz ist eine Erlaubnis nötig.</p>\n</aside>');
    expect(html).not.toContain('<blockquote>');
  });

  it('turns :::karten containers into a card grid', async () => {
    const md = ':::karten\n### Schritt 1\nMelde dich bei uns.\n\n### Schritt 2\nSelbstauskunft ausfüllen.\n:::';
    const html = await renderMarkdown(md);
    expect(html).toContain('<div class="cards">');
    expect((html.match(/<article class="card">/g) ?? []).length).toBe(2);
    expect(html).toContain('<h3>Schritt 1</h3>');
    expect(html).toContain('<p>Selbstauskunft ausfüllen.</p>');
  });

  it('strips raw html and scripts but keeps text', async () => {
    const html = await renderMarkdown('Hallo <script>alert(1)</script><img src=x onerror=alert(1)> <b>fett</b>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
    expect(html).toContain('Hallo');
  });

  it('is deterministic and handles empty input', async () => {
    expect(await renderMarkdown('')).toBe('');
    const a = await renderMarkdown('Text');
    expect(await renderMarkdown('Text')).toBe(a);
  });
});
