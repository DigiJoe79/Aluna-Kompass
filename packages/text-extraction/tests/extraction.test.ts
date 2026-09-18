import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTextExtraction } from '../src/extraction';

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, 'fixtures', name)));

describe('createTextExtraction', () => {
  it('meldet die installierten Sprachen', async () => {
    const probe = await createTextExtraction().probe();

    expect(probe.ok).toBe(true);
    if (probe.ok) expect(probe.languages).toContain('deu');
  });

  it('fragt die Werkzeuge nicht bei jedem Dokument neu ab', async () => {
    // `probe()` startet zwei Prozesse. Bei „Alles neu lesen“ über tausend
    // Dokumente wären das zweitausend — für eine Antwort, die sich zwischen
    // zwei Dokumenten nicht ändert.
    const extraction = createTextExtraction();

    const first = await extraction.probe();
    const second = await extraction.probe();

    expect(second).toBe(first);
  });

  it('nimmt die Textebene, wenn es eine gibt — ohne OCR', async () => {
    const pages = await createTextExtraction().extract({
      bytes: fixture('brief-digital.pdf'),
      languages: ['deu'],
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]!.source).toBe('layer');
    expect(pages[0]!.text).toContain('Tierarztrechnung');
  });

  it('erkennt eine Seite, die nur ein Bild ist', async () => {
    const pages = await createTextExtraction().extract({
      bytes: fixture('brief-scan.pdf'),
      languages: ['deu'],
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]!.source).toBe('ocr');
    // Wortlaut nie auf Gleichheit pruefen: Tesseract 5.3 und 5.5 unterscheiden
    // sich. Ein markantes, langes Wort reicht als Beweis, dass gelesen wurde.
    expect(pages[0]!.text.toLowerCase()).toContain('tierarztrechnung');
  }, 60_000);
});
