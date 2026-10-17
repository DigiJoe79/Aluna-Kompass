import { describe, expect, it } from 'vitest';
import { openingTags, read, relative, sourceFiles } from './source';

/**
 * Ein PDF im `<iframe>` zeigt der Browser-Betrachter; seine Werkzeugleiste blendet `pdfFrameSrc` aus (Designer
 * Stufe 2 Nr. 8, MUSTER § Seitenrahmen). Jeder Rahmen bildet seine Adresse darüber — außer denen, die eine Webseite
 * zeigen.
 */
const WEB_PAGES: Record<string, string> = {
  'app/(shell)/animals/proposals/[id]/preview-sheet.tsx': 'Zeigt die Quellseite eines Vorschlags, kein PDF.',
  'app/(shell)/site/publish/preview/preview-frame-client.tsx': 'Zeigt die Vorschau der Webseite, kein PDF.',
};

describe('PDF-Rahmen ohne Werkzeugleiste', () => {
  it('jedes <iframe> bildet src über pdfFrameSrc', () => {
    const bad = sourceFiles().flatMap((file) => {
      if (relative(file) in WEB_PAGES) return [];
      return openingTags(read(file), /iframe/)
        // `<iframe>` ohne Attribute steht nur in Kommentaren.
        .filter(({ tag }) => tag !== '<iframe>' && !/src=\{pdfFrameSrc\(/.test(tag))
        .map(({ line }) => `${relative(file)}:${line}`);
    });
    expect(bad).toEqual([]);
  });
});
