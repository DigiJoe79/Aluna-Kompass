import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { noopPdfTools, type PdfTools } from '@kompass/core';
import { createTestDeps, fakePdfTools } from '@kompass/core/testing';
import { createDeps } from '../src/app';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('pdf tools port', () => {
  it('refuses to merge without an implementation', async () => {
    await expect(noopPdfTools.merge([new Uint8Array([1])])).rejects.toThrow('no pdf tools configured');
  });

  it('the fake marks how many files it merged and records every call', async () => {
    const fake = fakePdfTools();
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);

    expect(text(await fake.merge([a, b]))).toBe('%PDF-FAKE 2');
    expect(text(await fake.merge([a]))).toBe('%PDF-FAKE 1');
    expect(fake.calls).toEqual([[a, b], [a]]);
  });

  it('test deps carry the fake, or what the test passes in', async () => {
    expect(text(await createTestDeps().pdf.merge([new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])]))).toBe('%PDF-FAKE 3');
    const own: PdfTools = { merge: async () => new Uint8Array([9]) };
    expect(createTestDeps({ pdf: own }).pdf).toBe(own);
  });

  it('app deps fall back to the noop, or take the implementation passed in', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-'));
    dirs.push(dir);
    const plain = createDeps({ dataPath: dir, env: 'test' });
    await expect(plain.pdf.merge([])).rejects.toThrow('no pdf tools configured');
    plain.close();
    const own: PdfTools = { merge: async () => new Uint8Array([9]) };
    const wired = createDeps({ dataPath: dir, env: 'test', pdf: own });
    expect(wired.pdf).toBe(own);
    wired.close();
  });
});
