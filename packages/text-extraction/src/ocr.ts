import { runTool } from './run';

/**
 * 300 dpi ist der Wert, bei dem Tesseract für Fließtext ausgelegt ist; darunter
 * leidet die Trefferquote, darüber wächst nur die Rechenzeit.
 */
export const OCR_DPI = 300;

/**
 * Obergrenze je gerenderter Seite. A4 mit 300 dpi sind 8,7 Megapixel und
 * bleiben darunter; eine übergroße Seite wird mit weniger dpi gerendert. Grund:
 * iOS-Scans melden ihre Seite in Bildpunkten als pt (1797 × 2572 pt bei 72 ppi,
 * PRT-2026-001) — mit festen 300 dpi wären das 80 Megapixel, und `pdftoppm`
 * überschritt auf dem NAS das Zeitlimit, bevor Tesseract überhaupt anfing.
 * Gemessen am 2026-10-28 (Mac, Seite 1 dieses Scans): PNG mit 300 dpi 22,6 s nur
 * fürs Rendern; Graustufen-Rohbild mit 116 dpi 0,2 s, Tesseract danach 2,2 s
 * bei vollständigem Text.
 */
export const OCR_MAX_PIXELS = 12_000_000;

/** Auflösung für eine Seite dieser Größe: 300 dpi, außer die Seite überschritte damit `OCR_MAX_PIXELS`. */
export function ocrResolution(widthPt: number, heightPt: number): number {
  const squareInches = (widthPt / 72) * (heightPt / 72);
  return Math.max(1, Math.min(OCR_DPI, Math.floor(Math.sqrt(OCR_MAX_PIXELS / squareInches))));
}

/** Seitengröße aus der Ausgabe von `pdfinfo -f n -l n` („Page    1 size:  595.276 x 841.89 pts (A4)“). */
export function parsePageSize(out: string): { width: number; height: number } | null {
  const match = /Page\s+\d+\s+size:\s+([\d.]+) x ([\d.]+) pts/.exec(out);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

/**
 * Eine einzelne Seite erkennen: Größe lesen, als Bitmap rendern, dann durch
 * Tesseract. Ohne lesbare Größe bleibt es bei 300 dpi.
 */
export async function ocrPage(
  bytes: Uint8Array,
  page: number,
  languages: string[],
  timeoutMs: number,
): Promise<string> {
  const info = await runTool('pdfinfo', ['-f', String(page), '-l', String(page), '-'], { input: bytes, timeoutMs });
  const size = parsePageSize(info.toString('utf8'));
  const dpi = size ? ocrResolution(size.width, size.height) : OCR_DPI;
  // Graustufen als Rohbild (PGM) statt PNG: Die zlib-Kompression eines verrauschten Foto-Scans kostete mehr als das
  // Rendern selbst (116 dpi: PNG 16 s, PGM 0,2 s); Tesseract liest PGM direkt und braucht keine Farbe.
  const image = await runTool(
    'pdftoppm',
    ['-gray', '-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile', '-'],
    { input: bytes, timeoutMs },
  );
  // `stdin`/`stdout` als `-`: Tesseract schreibt reinen Text nach stdout.
  const out = await runTool('tesseract', ['stdin', 'stdout', '-l', languages.join('+')], {
    input: image,
    timeoutMs,
  });
  return out.toString('utf8');
}
