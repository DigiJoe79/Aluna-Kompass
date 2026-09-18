import { describe, expect, it } from 'vitest';
import { renderHandbook } from '../src';

describe('renderHandbook', () => {
  it('keeps relative images and rewrites them to /help-bilder', async () => {
    const html = await renderHandbook('![Der Eingang](../bilder/akte/eingang.png)', { doc: 'akte/post-ablegen' });
    expect(html).toContain('<img src="/help-bilder/akte/eingang.png" alt="Der Eingang">');
  });

  it('drops images with a protocol or a path that leaves the handbook', async () => {
    expect(await renderHandbook('![x](https://example.org/x.png)', { doc: 'akte/post-ablegen' })).not.toContain('<img');
    expect(await renderHandbook('![x](../../etc/x.png)', { doc: 'akte/post-ablegen' })).not.toContain('<img');
  });

  it('rewrites links to other pages and keeps anchors and external links', async () => {
    const html = await renderHandbook('[Kontakte](../kontakte.md) [Abschnitt](#absaetze) [Astro](https://astro.build)', { doc: 'akte/post-ablegen' });
    expect(html).toContain('href="/help/kontakte"');
    expect(html).toContain('href="#absaetze"');
    expect(html).toContain('href="https://astro.build" rel="noopener"');
    expect(await renderHandbook('[Post](akte/post-ablegen.md)', { doc: 'inhalt' })).toContain('href="/help/akte/post-ablegen"');
  });

  it('shifts headings one level down and gives them ids', async () => {
    const html = await renderHandbook('# Titel\n\n## Absätze und Umbrüche\n\n### Tief', { doc: 'x' });
    expect(html).toContain('<h2 id="titel">Titel</h2>');
    expect(html).toContain('<h3 id="absaetze-und-umbrueche">Absätze und Umbrüche</h3>');
    expect(html).toContain('<h4 id="tief">Tief</h4>');
    expect(html).not.toContain('<h1');
  });

  it('still strips scripts and keeps the kompass directives', async () => {
    expect(await renderHandbook('<script>alert(1)</script>Text', { doc: 'x' })).not.toContain('script');
    expect(await renderHandbook('> Vorsicht', { doc: 'x' })).toContain('class="note"');
  });
});
