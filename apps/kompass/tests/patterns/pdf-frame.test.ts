import { describe, expect, it } from 'vitest';
import { type Allowlist, allowlistHygiene, openingTags, read, relative, sourceFiles, staleKeys } from './source';

/**
 * Ein PDF im `<iframe>` zeigt der Browser-Betrachter; seine Werkzeugleiste blendet `pdfFrameSrc` aus (Designer
 * Stufe 2 Nr. 8, MUSTER § Seitenrahmen). Jeder Rahmen bildet seine Adresse darüber — außer denen, die eine Webseite
 * zeigen.
 */
export const WEB_PAGES: Allowlist = {
  'app/(shell)/animals/proposals/[id]/preview-sheet.tsx': 'Zeigt die Quellseite eines Vorschlags, kein PDF.',
  'app/(shell)/site/publish/preview/preview-frame-client.tsx': 'Zeigt die Vorschau der Webseite, kein PDF.',
};

describe('PDF-Rahmen ohne Werkzeugleiste', () => {
  const frames = sourceFiles().flatMap((file) =>
    openingTags(read(file), /iframe/)
      // `<iframe>` ohne Attribute steht nur in Kommentaren.
      .filter(({ tag }) => tag !== '<iframe>' && !/src=\{pdfFrameSrc\(/.test(tag))
      .map(({ line }) => ({ where: `${relative(file)}:${line}`, file: relative(file) })),
  );

  it('jedes <iframe> bildet src über pdfFrameSrc', () => {
    expect(frames.filter(({ file }) => !(file in WEB_PAGES)).map(({ where }) => where)).toEqual([]);
  });

  allowlistHygiene(WEB_PAGES, () => staleKeys(WEB_PAGES, frames.map(({ file }) => file)));
});
