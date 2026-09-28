import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTextExtraction } from '../src/extraction';
import { readEmbeddedFiles } from '../src/embedded';
import { ToolMissingError } from '../src/run';
import { buildFixturePdf, buildPdfWithAttachments } from './pdf-with-attachment';

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, 'fixtures', name)));
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'kompass-embedded-test-'));
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('fixture mit-anhang.pdf', () => {
  it('is exactly what the builder produces', () => {
    // Neu erzeugen: `buildFixturePdf()` nach tests/fixtures/mit-anhang.pdf schreiben.
    expect(Buffer.from(fixture('mit-anhang.pdf')).equals(Buffer.from(buildFixturePdf()))).toBe(true);
  });
});

describe('readEmbeddedFiles', () => {
  it('lists and returns the embedded file with its name, never using the name as a path', async () => {
    const files = await readEmbeddedFiles({ bytes: fixture('mit-anhang.pdf') }, { tmpRoot });

    expect(files.map((f) => [f.name, f.mimeType])).toEqual([
      ['../evil.xml', 'application/xml'],
      ['factur-x.xml', 'application/xml'],
    ]);
    expect(text(files[0]!.bytes)).toBe('<evil/>\n');
    expect(text(files[1]!.bytes)).toContain('CrossIndustryInvoice');
    // `../evil.xml` als Pfad hätte eine Datei neben das Temp-Verzeichnis gelegt — also hierher.
    expect(existsSync(path.join(tmpRoot, 'evil.xml'))).toBe(false);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it('returns an empty list for a pdf without attachments', async () => {
    expect(await readEmbeddedFiles({ bytes: fixture('brief-digital.pdf') }, { tmpRoot })).toEqual([]);
    expect(await readEmbeddedFiles({ bytes: buildPdfWithAttachments([]) }, { tmpRoot })).toEqual([]);
  });

  it('skips a file above the size limit and stops after maxFiles', async () => {
    const bytes = buildPdfWithAttachments([
      { name: 'a.xml', content: '<a/>' },
      { name: 'b.bin', content: 'x'.repeat(2_000) },
      { name: 'c.txt', content: 'c' },
      { name: 'd.txt', content: 'd' },
    ]);

    const limited = await readEmbeddedFiles({ bytes, maxBytesPerFile: 1_000, maxFiles: 3 }, { tmpRoot });

    // b ist zu groß und fehlt; d liegt jenseits von maxFiles und wird gar nicht erst gespeichert.
    expect(limited.map((f) => [f.name, f.mimeType])).toEqual([
      ['a.xml', 'application/xml'],
      ['c.txt', 'text/plain'],
    ]);
    const all = await readEmbeddedFiles({ bytes }, { tmpRoot });
    expect(all.map((f) => f.name)).toEqual(['a.xml', 'b.bin', 'c.txt', 'd.txt']);
    expect(all[1]!.mimeType).toBeNull();
  });

  it('cleans the temp directory up, also when pdfdetach fails', async () => {
    await readEmbeddedFiles({ bytes: fixture('mit-anhang.pdf') }, { tmpRoot });
    expect(readdirSync(tmpRoot)).toEqual([]);

    await expect(readEmbeddedFiles({ bytes: new TextEncoder().encode('kein pdf') }, { tmpRoot })).rejects.toThrow(/pdfdetach/);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it('reports ToolMissingError when pdfdetach is absent', async () => {
    // `runTool` reicht kein `env` durch; ein leerer PATH lässt sich deshalb nicht
    // setzen. Ein Binary-Name, den es nirgends gibt, erzeugt dasselbe ENOENT.
    await expect(
      readEmbeddedFiles({ bytes: fixture('mit-anhang.pdf') }, { tmpRoot, bin: 'pdfdetach-does-not-exist' }),
    ).rejects.toBeInstanceOf(ToolMissingError);
    // Am Namen erkennbar — das Finanzmodul importiert dieses Paket nicht und fragt `error.name`.
    await expect(
      readEmbeddedFiles({ bytes: fixture('mit-anhang.pdf') }, { tmpRoot, bin: 'pdfdetach-does-not-exist' }),
    ).rejects.toMatchObject({ name: 'ToolMissingError' });
    expect(readdirSync(tmpRoot)).toEqual([]);
  });
});

describe('createTextExtraction().embeddedFiles', () => {
  it('reads the attachments through the port', async () => {
    const files = await createTextExtraction().embeddedFiles({ bytes: fixture('mit-anhang.pdf') });

    expect(files.map((f) => f.name)).toEqual(['../evil.xml', 'factur-x.xml']);
  });
});
