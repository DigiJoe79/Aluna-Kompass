import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPdfTools, MERGE_MAX_BYTES, MERGE_MAX_FILES, MERGE_TIMEOUT_MS, mergePdfs } from '../src/merge';
import { ToolMissingError } from '../src/run';

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, 'fixtures', name)));

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'kompass-merge-test-'));
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Nachweis mit einem zweiten Werkzeug aus poppler-utils, nicht mit dem Code unter Test. */
function inspect(bytes: Uint8Array): { pages: number; page: (n: number) => string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kompass-merge-inspect-'));
  const file = path.join(dir, 'out.pdf');
  writeFileSync(file, bytes);
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file], { encoding: 'utf8' }))?.[1]);
  const texts = Array.from({ length: pages }, (_, i) => execFileSync('pdftotext', ['-f', String(i + 1), '-l', String(i + 1), file, '-'], { encoding: 'utf8' }));
  rmSync(dir, { recursive: true, force: true });
  return { pages, page: (n) => texts[n - 1] ?? '' };
}

describe('mergePdfs', () => {
  it('merges two real pdfs into one with their pages in order', async () => {
    const merged = await mergePdfs([fixture('brief-digital.pdf'), fixture('mit-anhang.pdf'), fixture('brief-digital.pdf')], { tmpRoot });

    const result = inspect(merged);
    expect(result.pages).toBe(3);
    expect(result.page(1)).toContain('Tierarztrechnung');
    expect(result.page(2)).not.toContain('Tierarztrechnung');
    expect(result.page(3)).toContain('Tierarztrechnung');
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it('takes a single pdf as it is, page for page', async () => {
    expect(inspect(await mergePdfs([fixture('brief-digital.pdf')], { tmpRoot })).pages).toBe(1);
  });

  it('cleans the temp directory up, also when pdfunite fails', async () => {
    await expect(mergePdfs([fixture('brief-digital.pdf'), new TextEncoder().encode('kein pdf')], { tmpRoot })).rejects.toThrow(/pdfunite/);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it('reports ToolMissingError, recognisable by its name, when pdfunite is absent', async () => {
    const run = () => mergePdfs([fixture('brief-digital.pdf')], { tmpRoot, bin: 'pdfunite-does-not-exist' });
    await expect(run()).rejects.toBeInstanceOf(ToolMissingError);
    // Das Finanzmodul importiert dieses Paket nicht und fragt `error.name`.
    await expect(run()).rejects.toMatchObject({ name: 'ToolMissingError' });
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it('refuses nothing, more than 500 files and more than 200 MB before starting the tool', async () => {
    expect([MERGE_MAX_FILES, MERGE_MAX_BYTES, MERGE_TIMEOUT_MS]).toEqual([500, 200 * 1024 * 1024, 120_000]);
    const small = fixture('brief-digital.pdf');

    await expect(mergePdfs([], { tmpRoot })).rejects.toThrow(/nothing to merge/);
    await expect(mergePdfs(Array.from({ length: MERGE_MAX_FILES + 1 }, () => small), { tmpRoot })).rejects.toThrow(/501 files/);
    await expect(mergePdfs([small, new Uint8Array(MERGE_MAX_BYTES)], { tmpRoot })).rejects.toThrow(/200 MB/);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });
});

describe('createPdfTools', () => {
  it('merges through the port', async () => {
    const merged = await createPdfTools().merge([fixture('brief-digital.pdf'), fixture('brief-scan.pdf')]);

    expect(inspect(merged).pages).toBe(2);
  });
});
