import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileTypst, findTypstBinary } from '../src/typst';
import { PdfPageOutOfRangeError, renderPdfPage } from '../src/pdf-pages';

/**
 * Seitenbilder für `PdfPages` (Designer Runde 6, Punkt 4): ein echtes Typst-PDF mit zwei Seiten, durch `pdftoppm`.
 */
let dir: string;
let twoPages: Uint8Array;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kompass-pdf-pages-'));
  await writeFile(path.join(dir, 'two.typ'), 'Seite eins\n#pagebreak()\nSeite zwei\n');
  await compileTypst({ binary: findTypstBinary(), rootDir: dir, fontPaths: [], entry: path.join(dir, 'two.typ'), output: path.join(dir, 'two.pdf') });
  twoPages = new Uint8Array(await readFile(path.join(dir, 'two.pdf')));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('renderPdfPage', () => {
  it('renders each of two pages as PNG', async () => {
    for (const page of [1, 2]) {
      const png = await renderPdfPage(twoPages, page, { dpi: 72 });
      expect([...png.subarray(0, 8)]).toEqual(PNG);
    }
  });

  it('a higher resolution gives a wider image', async () => {
    const width = (png: Uint8Array) => Buffer.from(png).readUInt32BE(16);
    const low = await renderPdfPage(twoPages, 1, { dpi: 72 });
    const high = await renderPdfPage(twoPages, 1, { dpi: 144 });
    expect(width(high)).toBeGreaterThan(width(low) * 1.9);
  });

  it('refuses a page outside the document', async () => {
    await expect(renderPdfPage(twoPages, 3, { dpi: 72 })).rejects.toBeInstanceOf(PdfPageOutOfRangeError);
    await expect(renderPdfPage(twoPages, 0, { dpi: 72 })).rejects.toBeInstanceOf(PdfPageOutOfRangeError);
  });

  it('refuses arguments that are not plain numbers in range', async () => {
    await expect(renderPdfPage(twoPages, 1.5, { dpi: 72 })).rejects.toThrow(/page/);
    await expect(renderPdfPage(twoPages, 1, { dpi: 10_000 })).rejects.toThrow(/dpi/);
  });

  it('fails on bytes that are no PDF', async () => {
    await expect(renderPdfPage(new TextEncoder().encode('kein PDF'), 1, { dpi: 72 })).rejects.toThrow();
  });
});
