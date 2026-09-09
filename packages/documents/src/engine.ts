import type { DocumentEngine } from '@kompass/core';
import { probeBase, resolveBases, type ResolvedBase } from './bases';
import { createTypstRenderer, resolveAssetDirs } from './renderer';
import { buildPayload } from './templates';

/**
 * Die Umsetzung der `DocumentEngine`-Schnittstelle des Kerns: Typst-Aufruf,
 * Payload-Bau aus dem Theme, Basis-Auflösung aus mitgelieferten Dateien plus
 * dem Vereinsvolume. Beim Erzeugen einmal aufgelöst.
 */
export function createDocumentEngine(opts: { documentTemplatesDir?: string | null } = {}): DocumentEngine {
  const dirs = resolveAssetDirs();
  const bases = resolveBases({
    templatesDir: dirs.templatesDir,
    documentTemplatesDir: opts.documentTemplatesDir ?? dirs.documentTemplatesDir,
  });
  const renderer = createTypstRenderer();
  const list = (): ResolvedBase[] => [...bases.values()];

  return {
    bases: () => list().map((b) => ({ id: b.id, label: b.label, kind: b.kind, checksum: b.checksum })),
    base: (id) => {
      const b = bases.get(id);
      return b ? { id: b.id, label: b.label, kind: b.kind, checksum: b.checksum } : undefined;
    },
    probe: (baseId) => probeBase({ renderer, baseId, bases }),
    render: ({ baseId, bodyTypst, slots, context }) =>
      renderer.renderDocument({
        baseId,
        bases,
        bodyTypst,
        payload: { ...buildPayload(context), slots },
        logo: context.logo,
      }),
  };
}
