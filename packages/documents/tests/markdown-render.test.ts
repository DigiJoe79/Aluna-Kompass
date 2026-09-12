import { renderMarkdownTypst } from '@kompass/markdown';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    ['Tabelle mit Ausrichtung', '| Posten | Betrag |\n|:--|--:|\n| Beitrag | 60,00 € |\n| Spende | 25,00 € |'],
    ['Tief verschachtelte Listen', '- a\n  - a1\n    - a1x\n  - a2\n- b\n\n1. eins\n   1. eins a\n2. zwei'],
    ['Code und Durchstreichen', 'Ein `Wert` im Text.\n\n```\nconst a = 1;\n```\n\n~~gestrichen~~'],
    ['Links', '[Satzung](https://example.org/s), [Mail](mailto:a@example.org), [abgelehnt](javascript:alert(1)) und https://example.org'],
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

describe('page breaks', () => {
  /** Ein PDF trägt je Seite ein `/Type /Page` im Klartext — das reicht als Seitenzähler. */
  const pages = (pdf: Uint8Array): number =>
    (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

  it('::seitenumbruch starts a new page', async () => {
    const ohne = await letter('Seite eins.\n\nNoch Seite eins.');
    const mit = await letter('Seite eins.\n\n::seitenumbruch\n\nSeite zwei.');
    expect(pages(ohne)).toBe(1);
    expect(pages(mit)).toBe(2);
  });

  it('does not append a blank page for a break at the end of the text', async () => {
    // `weak: true` verhindert genau das: einen Umbruch, hinter dem nichts mehr kommt.
    const pdf = await letter('Nur eine Seite.\n\n::seitenumbruch');
    expect(pages(pdf)).toBe(1);
  });

  it('two breaks in a row make one new page, not two', async () => {
    const pdf = await letter('Seite eins.\n\n::seitenumbruch\n\n::seitenumbruch\n\nSeite zwei.');
    expect(pages(pdf)).toBe(2);
  });
});

describe('the example in the help page', () => {
  /**
   * `docs/briefe-formatieren.md` verspricht der schreibenden Person, dass ihr
   * Beispielbrief durch die Pipeline geht. Hier wird das Versprechen eingelöst —
   * und die Seite kann nicht unbemerkt von der Wirklichkeit abweichen.
   */
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

  function exampleFromHelpPage(): string {
    const page = readFileSync(path.join(ROOT, 'docs/briefe-formatieren.md'), 'utf8');
    const match = /<!-- beispielbrief -->\s*````markdown\n([\s\S]*?)\n````/.exec(page);
    if (!match?.[1]) throw new Error('kein mit <!-- beispielbrief --> markierter Block in docs/briefe-formatieren.md');
    return match[1];
  }

  it('renders and runs onto a second page', async () => {
    const pdf = await letter(exampleFromHelpPage());
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
    const pages = (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(2);
  });
});
