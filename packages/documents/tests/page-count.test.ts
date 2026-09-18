import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pdfPageCount } from '../src/page-count';

/**
 * Wie viele Seiten ein gerendertes Schreiben hat, weiss sonst niemand: Die
 * Vorschau bekommt die Bytes und kann sie nicht zählen, und ein zweiter Lauf
 * nur zum Zählen wäre derselbe Brief ein zweites Mal.
 */
const FIXTURE = path.resolve(import.meta.dirname, '../../../apps/kompass/e2e/fixtures/brief-digital.pdf');

describe('pdfPageCount', () => {
  it('liest die Seitenzahl aus einem echten Typst-PDF', () => {
    expect(pdfPageCount(readFileSync(FIXTURE))).toBe(1);
  });

  it('nimmt die Angabe der Metadaten', () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\n<xmpTPg:NPages>7</xmpTPg:NPages>\n');
    expect(pdfPageCount(bytes)).toBe(7);
  });

  it('fällt auf den Seitenbaum zurück, wenn keine Metadaten da sind', () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\n2 0 obj<</Type/Pages/Count 3/Kids[...]>>endobj\n');
    expect(pdfPageCount(bytes)).toBe(3);
  });

  it('nimmt den höchsten Zählerstand: ein Seitenbaum kann Äste haben', () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\n<</Type/Pages/Count 2>>\n<</Type/Pages/Count 5>>\n');
    expect(pdfPageCount(bytes)).toBe(5);
  });

  it('gibt null zurück, wenn nichts dasteht — geraten wird nicht', () => {
    expect(pdfPageCount(new TextEncoder().encode('kein PDF'))).toBeNull();
  });
});
