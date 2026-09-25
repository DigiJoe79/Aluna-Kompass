/**
 * PDF-Werkzeuge, wie der Kern sie sieht — heute nur das Zusammenfügen
 * mehrerer PDFs zu einem (Sammel-PDFs des Serienlaufs, Finanzen F6b). Die
 * Umsetzung (`pdfunite`) liegt in `@kompass/text-extraction`; der Kern kennt
 * nur diese Schnittstelle, wie bei `TextExtraction`, damit die Abhängigkeit
 * einseitig bleibt und Tests ohne Binaries laufen.
 *
 * Fehlt das Werkzeug in der Umgebung, wirft `merge` einen Fehler mit
 * `name === 'ToolMissingError'` — ein Modul erkennt ihn am Namen, ohne das
 * Umsetzungspaket zu importieren.
 */
export interface PdfTools {
  /** Die PDFs in dieser Reihenfolge zu einem PDF; ihre Seiten hintereinander. */
  merge(files: readonly Uint8Array[]): Promise<Uint8Array>;
}

/** Fallback für Kontexte ohne Werkzeuge (Skripte, manche Tests). */
export const noopPdfTools: PdfTools = {
  merge: async () => {
    throw new Error('no pdf tools configured');
  },
};

/**
 * Attrappe für Service-Tests: liefert `%PDF-FAKE <Anzahl>` und zeichnet jeden
 * Aufruf auf. Über `@kompass/core/testing` erreichbar.
 */
export function fakePdfTools(): PdfTools & { calls: (readonly Uint8Array[])[] } {
  const calls: (readonly Uint8Array[])[] = [];
  return {
    calls,
    merge: async (files) => {
      calls.push(files);
      return new TextEncoder().encode(`%PDF-FAKE ${files.length}`);
    },
  };
}
