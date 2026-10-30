import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OCR_DPI, OCR_MAX_PIXELS, ocrPage, ocrResolution, parsePageSize } from '../src/ocr';

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, 'fixtures', name)));
const pixels = (widthPt: number, heightPt: number, dpi: number) => ((widthPt / 72) * dpi) * ((heightPt / 72) * dpi);

describe('ocrResolution', () => {
  it('rendert A4 mit der vollen Auflösung', () => {
    expect(ocrResolution(595.276, 841.89)).toBe(OCR_DPI);
  });

  it('senkt die Auflösung bei übergroßen Seiten, statt 80 Megapixel zu rendern', () => {
    // iOS-Scan aus der Akte (PRT-2026-001): 1797 × 2572 pt bei 72 ppi Bildauflösung.
    // Mit festen 300 dpi wären das ≈ 80 MPx je Seite — auf dem NAS über 30 s nur fürs Rendern.
    const dpi = ocrResolution(1797, 2572);

    expect(dpi).toBeLessThan(OCR_DPI);
    expect(pixels(1797, 2572, dpi)).toBeLessThanOrEqual(OCR_MAX_PIXELS);
    // Nicht kleiner als nötig: Die Bilder darin haben 72 ppi, darunter verlöre die Erkennung.
    expect(dpi).toBeGreaterThanOrEqual(72);
  });

  it('bleibt bei jeder Seitengröße unter der Pixelgrenze', () => {
    for (const [w, h] of [[842, 1191], [2384, 3370], [14400, 14400], [226, 8000]] as const) {
      expect(pixels(w, h, ocrResolution(w, h))).toBeLessThanOrEqual(OCR_MAX_PIXELS);
    }
  });
});

describe('parsePageSize', () => {
  it('liest die Größe aus der Ausgabe von pdfinfo', () => {
    expect(parsePageSize('Pages:           3\nPage    2 size:  1797 x 2572 pts\n')).toEqual({ width: 1797, height: 2572 });
    expect(parsePageSize('Page    1 size:  595.276 x 841.89 pts (A4)\n')).toEqual({ width: 595.276, height: 841.89 });
  });

  it('gibt null, wenn keine Größe dasteht', () => {
    expect(parsePageSize('Pages: 1\n')).toBeNull();
  });
});

describe('ocrPage', () => {
  it('erkennt eine übergroße Scanseite', async () => {
    // Dieselbe Seite wie brief-scan.pdf, aber auf 1797 × 2572 pt gesetzt wie der iOS-Scan.
    const text = await ocrPage(fixture('scan-gross.pdf'), 1, ['deu'], 30_000);

    expect(text.toLowerCase()).toContain('tierarztrechnung');
  }, 60_000);
});
