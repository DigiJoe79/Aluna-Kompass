import { fakeTextExtraction, noopTextExtraction } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';

describe('text extraction port', () => {
  it('liefert in Tests eine Attrappe statt eines Binaries', async () => {
    const deps = createTestDeps();
    const probe = await deps.textExtraction.probe();
    expect(probe.ok).toBe(true);
    const pages = await deps.textExtraction.extract({ bytes: new Uint8Array([1]), languages: ['deu'] });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ page: 1, source: 'layer' });
  });

  it('reicht durch, was der Test vorgibt, und merkt sich den Aufruf', async () => {
    const seen: { languages: string[] }[] = [];
    const deps = createTestDeps({
      textExtraction: fakeTextExtraction({
        pages: [
          { page: 1, text: 'Seite eins', source: 'layer' },
          { page: 2, text: 'Seite zwei', source: 'ocr' },
        ],
        onExtract: (o) => seen.push({ languages: o.languages }),
      }),
    });

    const pages = await deps.textExtraction.extract({ bytes: new Uint8Array([1]), languages: ['deu', 'eng'] });

    expect(pages.map((p) => p.source)).toEqual(['layer', 'ocr']);
    expect(seen).toEqual([{ languages: ['deu', 'eng'] }]);
  });

  it('meldet ohne Umsetzung, dass nichts eingerichtet ist', async () => {
    const probe = await noopTextExtraction.probe();
    expect(probe).toEqual({ ok: false, error: 'no text extraction configured' });
    await expect(noopTextExtraction.extract({ bytes: new Uint8Array(), languages: [] })).rejects.toThrow();
  });
});
