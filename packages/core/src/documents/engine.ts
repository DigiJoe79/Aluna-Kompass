import type { DocumentRenderContext, DocumentSlots } from '../modules/manifest';

/**
 * Die Dokument-Engine, wie der Kern sie sieht. Die Umsetzung (Typst-Aufruf,
 * Payload-Bau aus dem Theme, Basis-Auflösung aus Datei + Volume) liegt in
 * `@kompass/documents` — der Kern kennt nur diese Schnittstelle, damit die
 * Abhängigkeit einseitig bleibt.
 */
export interface DocumentBase {
  id: string;
  label: string;
  kind: string;
  /** SHA-256 der aufgelösten Basis-`.typ`; wandert in den Dokument-Snapshot. */
  checksum: string;
}

export interface DocumentEngine {
  /** Alle auflösbaren Basis-Vorlagen (mitgeliefert + Volume). */
  bases(): DocumentBase[];
  base(id: string): DocumentBase | undefined;
  /** Prüf-Render einer Basis mit Minimal-Payload. */
  probe(baseId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Baut den Payload aus dem Theme, setzt den Körper in die Basis, kompiliert.
   * Gibt die Seitenzahl mit heraus: Sie fällt beim Rendern ohnehin an, und wer
   * sie später braucht, müsste denselben Brief sonst ein zweites Mal setzen.
   * `null`, wenn sie sich aus dem Ergebnis nicht ablesen lässt.
   */
  render(opts: {
    baseId: string;
    bodyTypst: string;
    slots: DocumentSlots;
    context: DocumentRenderContext;
  }): Promise<{ bytes: Uint8Array; pages: number | null }>;
}

/** Fallback für Kontexte, die keine Dokumente rendern (manche Tests, Skripte). */
export const noopDocumentEngine: DocumentEngine = {
  bases: () => [],
  base: () => undefined,
  probe: async () => ({ ok: false, error: 'no document engine configured' }),
  render: async () => {
    throw new Error('no document engine configured');
  },
};
