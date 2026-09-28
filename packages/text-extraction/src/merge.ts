import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PdfTools } from '@kompass/core';
import { runTool } from './run';

/** Höchstens so viele PDFs je Aufruf — ein Serienlauf eines großen Vereins. */
export const MERGE_MAX_FILES = 500;
/** Höchstens so viele Bytes aller Eingaben zusammen. */
export const MERGE_MAX_BYTES = 200 * 1024 * 1024;
/** Zeitlimit des einen `pdfunite`-Aufrufs. */
export const MERGE_TIMEOUT_MS = 120_000;

/**
 * Mehrere PDFs zu einem zusammenfügen (Sammel-PDFs, Finanzen F6b). Alles
 * geschieht in einem eigenen Temp-Verzeichnis, das `finally` wieder löscht:
 * die Eingaben als `0001.pdf` …, dann `pdfunite 0001.pdf … out.pdf`. Die
 * Grenzen greifen, bevor etwas auf die Platte geht.
 *
 * `opts` ist nur für Tests: ein anderes Binary (fehlendes Werkzeug) und ein
 * anderes Wurzelverzeichnis (Aufräumen nachweisen).
 */
export async function mergePdfs(files: readonly Uint8Array[], opts: { bin?: string; tmpRoot?: string } = {}): Promise<Uint8Array> {
  if (files.length === 0) throw new Error('nothing to merge');
  if (files.length > MERGE_MAX_FILES) throw new Error(`${files.length} files exceed the limit of ${MERGE_MAX_FILES}`);
  const total = files.reduce((sum, file) => sum + file.byteLength, 0);
  if (total > MERGE_MAX_BYTES) throw new Error(`${total} bytes exceed the limit of ${MERGE_MAX_BYTES / (1024 * 1024)} MB`);

  const bin = opts.bin ?? 'pdfunite';
  const dir = await mkdtemp(path.join(opts.tmpRoot ?? os.tmpdir(), 'kompass-merge-'));
  try {
    const inputs: string[] = [];
    for (const [index, bytes] of files.entries()) {
      const input = path.join(dir, `${String(index + 1).padStart(4, '0')}.pdf`);
      await writeFile(input, bytes);
      inputs.push(input);
    }
    const output = path.join(dir, 'out.pdf');
    await runTool(bin, [...inputs, output], { timeoutMs: MERGE_TIMEOUT_MS });
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Die echte Umsetzung des Kern-Ports `PdfTools`. */
export function createPdfTools(): PdfTools {
  return { merge: (files) => mergePdfs(files) };
}
