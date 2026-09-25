import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { EmbeddedFile, EmbeddedFilesOptions } from '@kompass/core';
import { runTool } from './run';

/** Zeitlimit je `pdfdetach`-Aufruf. */
export const EMBEDDED_TIMEOUT_MS = 30_000;
export const EMBEDDED_MAX_FILES = 10;
export const EMBEDDED_MAX_BYTES_PER_FILE = 5 * 1024 * 1024;

/**
 * Nur zur Anzeige: `pdfdetach` nennt keinen Typ, die Endung ist alles, was
 * es gibt. Unbekannte Endungen bleiben `null`, statt zu raten.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
};

function mimeTypeOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? null : MIME_BY_EXTENSION[name.slice(dot).toLowerCase()] ?? null;
}

/**
 * `pdfdetach -list` schreibt `N embedded files`, dann je Anhang `i: name`
 * (ab 1). Ein Name kann einen Zeilenumbruch enthalten und damit eine Zeile
 * vortäuschen — gezählt wird deshalb nur bis `N`, und je Nummer gilt die
 * erste Zeile.
 */
function parseList(out: string): { index: number; name: string }[] {
  const lines = out.split('\n');
  const count = Number(/^(\d+) embedded files?/.exec(lines[0]?.trim() ?? '')?.[1] ?? 0);
  const seen = new Map<number, string>();
  for (const line of lines.slice(1)) {
    const m = /^(\d+): (.*)$/.exec(line);
    if (!m) continue;
    const index = Number(m[1]);
    if (index >= 1 && index <= count && !seen.has(index)) seen.set(index, m[2]!);
  }
  return [...seen.entries()].sort(([a], [b]) => a - b).map(([index, name]) => ({ index, name }));
}

/**
 * Die eingebetteten Dateien eines PDFs lesen (Spec Vorarbeiten § 3). Alles
 * geschieht in einem eigenen Temp-Verzeichnis, das `finally` wieder löscht:
 * erst `-list`, dann je Anhang gezielt `-save N -o <dir>/<N>.bin`. Der Name
 * aus dem PDF wird **nie** als Pfad verwendet — er kommt aus fremder Hand.
 *
 * `internal` ist nur für Tests: ein anderes Binary (fehlendes Werkzeug) und
 * ein anderes Wurzelverzeichnis (Aufräumen nachweisen).
 */
export async function readEmbeddedFiles(
  opts: EmbeddedFilesOptions,
  internal: { bin?: string; tmpRoot?: string } = {},
): Promise<EmbeddedFile[]> {
  const bin = internal.bin ?? 'pdfdetach';
  const maxFiles = opts.maxFiles ?? EMBEDDED_MAX_FILES;
  const maxBytes = opts.maxBytesPerFile ?? EMBEDDED_MAX_BYTES_PER_FILE;
  const dir = await mkdtemp(path.join(internal.tmpRoot ?? os.tmpdir(), 'kompass-embedded-'));

  try {
    const input = path.join(dir, 'in.pdf');
    await writeFile(input, opts.bytes);

    const listed = await runTool(bin, ['-list', '-enc', 'UTF-8', input], { timeoutMs: EMBEDDED_TIMEOUT_MS });
    const files: EmbeddedFile[] = [];

    for (const { index, name } of parseList(listed.toString('utf8')).slice(0, maxFiles)) {
      const target = path.join(dir, `${index}.bin`);
      await runTool(bin, ['-save', String(index), '-o', target, input], { timeoutMs: EMBEDDED_TIMEOUT_MS });
      if ((await stat(target)).size > maxBytes) continue;
      files.push({ name, bytes: new Uint8Array(await readFile(target)), mimeType: mimeTypeOf(name) });
    }

    return files;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
