import { describe, expect, it } from 'vitest';
import { pdfFrameSrc } from '@/lib/pdf-frame-src';

// PDF-Vorschau ohne die Werkzeugleiste des Browser-Betrachters (Designer Stufe 2 Nr. 8, Z8). Wirkt in Chromium;
// Treffersprünge über `#page=` bleiben.
describe('pdfFrameSrc', () => {
  it('hängt toolbar=0 an', () => {
    expect(pdfFrameSrc('/dms/1/file')).toBe('/dms/1/file#toolbar=0');
    expect(pdfFrameSrc('blob:http://x/abc')).toBe('blob:http://x/abc#toolbar=0');
  });
  it('behält die Seite: #page=N&toolbar=0', () => {
    expect(pdfFrameSrc('/dms/1/preview', { page: 3 })).toBe('/dms/1/preview#page=3&toolbar=0');
  });
  it('ersetzt ein vorhandenes Fragment statt ein zweites anzuhängen', () => {
    expect(pdfFrameSrc('/a#page=2')).toBe('/a#toolbar=0');
  });
  it('fit: width legt die Seite auf die Breite des Rahmens (Runde 3, 030–035)', () => {
    expect(pdfFrameSrc('/dms/1/file', { fit: 'width' })).toBe('/dms/1/file#toolbar=0&view=FitH');
  });
});
