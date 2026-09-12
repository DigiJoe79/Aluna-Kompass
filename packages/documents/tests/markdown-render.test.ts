import { renderMarkdownTypst } from '@kompass/markdown';
import { describe, expect, it } from 'vitest';
import { createTypstRenderer, resolveAssetDirs, resolveBases } from '../src';

const bases = resolveBases(resolveAssetDirs({}));
const renderer = createTypstRenderer();

const payload = {
  brand: {
    primary: '#2F5D68',
    primarySoft: '#E3EEF0',
    accent: '#9C5637',
    ink: '#191C1F',
    muted: '#666D75',
    line: '#E4E4E0',
    fontBody: 'Source Sans 3',
    fontHeading: 'Source Serif 4',
    fontMono: 'IBM Plex Mono',
  },
  organization: { 'organization.name': 'Musterverein e.V.', 'organization.city': 'Musterstadt' },
  number: 'BRF-2026-001',
  issuedDate: '05.09.2026',
  slots: { kind: 'letter', title: 'Test', subject: 'Test', recipient: 'Max Mustermann' },
};

/** Der Weg, den ein Brief wirklich nimmt: Markdown → Typst → PDF. Ein Zeichenkettentest sieht nicht, ob Typst das Ergebnis übersetzt. */
async function letter(markdown: string): Promise<Uint8Array> {
  return renderer.renderDocument({ baseId: 'a4-mit-briefkopf', bases, bodyTypst: await renderMarkdownTypst(markdown), payload });
}

describe('markdown bodies compile', () => {
  const bodies: [string, string][] = [
    ['Überschriften, Listen, Betonung', '# Titel\n\nText mit **fett** und _kursiv_.\n\n- eins\n  - eins a\n- zwei\n\n1. erstens\n2. zweitens'],
    ['Tabelle, Zitat, Trennlinie', '| A | B |\n|---|---|\n| 1 | 2 |\n\n> Hinweis\n\n---'],
    ['Code und Durchstreichen', 'Ein `Wert` im Text.\n\n```\nconst a = 1;\n```\n\n~~gestrichen~~'],
    ['Links', '[Satzung](https://example.org/s) und https://example.org'],
    ['Kartenraster', ':::karten\n### Karte A\n\nText A\n\n### Karte B\n\nText B\n:::'],
    ['Typst-Sonderzeichen im Fließtext', 'Kosten #panic("x"), [box], $x^2$, @label, ~ und C:\\temp'],
    ['Zeichen am Zeilenanfang', 'Guten Tag,\n\n= Umsatz 2026 ist das Thema.\n\n\\- kein Listenpunkt\n\n/ Begriff: Erklärung'],
    ['Schrägstriche', 'und/oder // keine Notiz und /* kein Kommentar */ mehr Text'],
  ];

  for (const [name, markdown] of bodies) {
    it(name, async () => {
      const pdf = await letter(markdown);
      expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
    });
  }
});
