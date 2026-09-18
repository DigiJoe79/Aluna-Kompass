import path from 'node:path';
import type { DocumentEngine } from '@kompass/core';
import { probeBase, resolveBases, type ResolvedBase } from './bases';
import { createTypstRenderer, resolveAssetDirs } from './renderer';
import { pdfPageCount } from './page-count';
import { buildPayload } from './templates';

/**
 * Die Umsetzung der `DocumentEngine`-Schnittstelle des Kerns: Typst-Aufruf,
 * Payload-Bau aus dem Theme, Auflösung der Basis-Vorlagen sowie der Schriften
 * und Grafiken aus dem Vereinsvolume. Beim Erzeugen einmal aufgelöst.
 */
export function createDocumentEngine(opts: { documentTemplatesDir?: string | null } = {}): DocumentEngine {
  const dirs = resolveAssetDirs();
  const volumeDir = opts.documentTemplatesDir ?? dirs.documentTemplatesDir;
  const bases = resolveBases({ templatesDir: dirs.templatesDir, documentTemplatesDir: volumeDir });
  const renderer = createTypstRenderer();
  const list = (): ResolvedBase[] => [...bases.values()];

  // Schriften und Grafiken, die ein Verein neben den `.typ` ins Volume legt.
  const fontPaths = volumeDir ? [path.join(volumeDir, 'fonts')] : [];
  const assetsDir = volumeDir ? path.join(volumeDir, 'assets') : null;

  return {
    bases: () => list().map((b) => ({ id: b.id, label: b.label, kind: b.kind, checksum: b.checksum })),
    base: (id) => {
      const b = bases.get(id);
      return b ? { id: b.id, label: b.label, kind: b.kind, checksum: b.checksum } : undefined;
    },
    probe: (baseId) => probeBase({ renderer, baseId, bases, fontPaths, assetsDir }),
    render: async ({ baseId, bodyTypst, slots, context }) => {
      const bytes = await renderer.renderDocument({
        baseId,
        bases,
        bodyTypst,
        payload: { ...buildPayload(context), slots },
        logo: context.logo,
        fontPaths,
        assetsDir,
      });
      return { bytes, pages: pdfPageCount(bytes) };
    },
  };
}
