import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTextLayer } from '../src/layer';

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, 'fixtures', name)));

describe('readTextLayer', () => {
  it('liest die Textebene eines digital erzeugten PDFs', async () => {
    const pages = await readTextLayer(fixture('brief-digital.pdf'), 30_000);

    expect(pages).toHaveLength(1);
    // Wortlaut nie auf Gleichheit pruefen — nur, dass der Inhalt da ist.
    expect(pages[0]).toContain('Tierarztrechnung');
    expect(pages[0]).toContain('Bärbel');
  });

  it('liefert für einen Scan eine leere Seite statt eines Fehlers', async () => {
    const pages = await readTextLayer(fixture('brief-scan.pdf'), 30_000);

    expect(pages).toHaveLength(1);
    expect(pages[0]!.trim()).toBe('');
  });
});
