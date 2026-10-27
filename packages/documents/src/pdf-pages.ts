import { spawn } from 'node:child_process';
import { pdfPageCount } from './page-count';

/**
 * Seitenbilder eines PDF für den Baustein `PdfPages` (Designer Runde 6, Punkt 4): Der Browser-Betrachter lässt sich
 * nicht gestalten, also zeigt die Oberfläche jede Seite als Bild. Gerendert wird mit `pdftoppm` (poppler-utils, im
 * Image wie für die Texterkennung) — das geht für jedes PDF, auch für Scans.
 *
 * Eingabe sind nur Bytes und Zahlen: Das PDF geht über stdin, die Argumente stehen fest, kein Pfad aus einer Anfrage
 * reicht bis zum Werkzeug. Zeitlimit und Größe der Ausgabe sind begrenzt.
 */
export class PdfPageOutOfRangeError extends Error {
  override name = 'PdfPageOutOfRangeError';
}

/** Auflösungen, die ein Aufrufer verlangen darf: genug für ein Blatt in doppelter Dichte, nie ein Poster. */
const DPI_RANGE = { min: 36, max: 400 } as const;
const DEFAULT_TIMEOUT_MS = 15_000;
/** Ein A4-Blatt bei 400 dpi ist als PNG kaum über 10 MB; was darüber geht, ist kein Bericht. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export async function renderPdfPage(bytes: Uint8Array, page: number, opts: { dpi: number; timeoutMs?: number }): Promise<Uint8Array> {
  if (!Number.isInteger(page)) throw new Error(`page must be an integer, got ${page}`);
  if (!Number.isInteger(opts.dpi) || opts.dpi < DPI_RANGE.min || opts.dpi > DPI_RANGE.max) throw new Error(`dpi must be an integer in ${DPI_RANGE.min}–${DPI_RANGE.max}, got ${opts.dpi}`);
  const total = pdfPageCount(bytes);
  if (page < 1 || (total !== null && page > total)) throw new PdfPageOutOfRangeError(`page ${page} outside 1–${total ?? '?'}`);
  const args = ['-png', '-r', String(opts.dpi), '-f', String(page), '-l', String(page), '-singlefile', '-'];
  return runPdftoppm(args, bytes, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, page);
}

function runPdftoppm(args: string[], input: Uint8Array, timeoutMs: number, page: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn('pdftoppm', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let failed: Error | null = null;
    const fail = (error: Error) => {
      if (failed) return;
      failed = error;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => fail(new Error(`pdftoppm exceeded ${timeoutMs} ms`)), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_OUTPUT_BYTES) return fail(new Error(`pdftoppm output above ${MAX_OUTPUT_BYTES} bytes`));
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString('utf8');
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(error.code === 'ENOENT' ? new Error('pdftoppm is not installed (poppler-utils)') : error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failed) return reject(failed);
      // Eine Seitenzahl außerhalb meldet pdftoppm mit „Wrong page range“ (Code 99) — wenn das PDF selbst keine Zahl trug.
      if (/Wrong page range/.test(stderr)) return reject(new PdfPageOutOfRangeError(`page ${page} outside the document`));
      if (code !== 0 || size === 0) return reject(new Error(`pdftoppm failed (${code}): ${stderr.slice(0, 400)}`));
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    // Ein PDF, das pdftoppm nicht ganz liest, schließt stdin früh — das ist kein Fehler des Aufrufers.
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(input));
  });
}
