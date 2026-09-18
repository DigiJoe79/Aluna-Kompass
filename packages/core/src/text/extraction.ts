/** Eine Seite Text, plus die Herkunft — für Protokoll und Fehlersuche. */
export interface PageText {
  page: number;
  text: string;
  source: 'layer' | 'ocr';
}

export interface ExtractOptions {
  bytes: Uint8Array;
  /** Tesseract-Sprachkürzel, z. B. `['deu', 'eng']`. */
  languages: string[];
}

export type ProbeResult = { ok: true; languages: string[] } | { ok: false; error: string };

/**
 * Texterkennung, wie der Kern sie sieht. Die Umsetzung (Poppler, Tesseract)
 * liegt in `@kompass/text-extraction` — der Kern kennt nur diese Schnittstelle,
 * damit die Abhängigkeit einseitig bleibt und Tests ohne Binaries laufen.
 *
 * Der Kern **ruft sie selbst nie**; er reicht sie durch, wie `files('dms')`.
 */
export interface TextExtraction {
  /** Was die Umgebung kann: Binaries vorhanden, welche Sprachen installiert. */
  probe(): Promise<ProbeResult>;
  extract(opts: ExtractOptions): Promise<PageText[]>;
}

/** Fallback für Kontexte ohne Erkennung (Skripte, manche Tests). */
export const noopTextExtraction: TextExtraction = {
  probe: async () => ({ ok: false, error: 'no text extraction configured' }),
  extract: async () => {
    throw new Error('no text extraction configured');
  },
};

/** Attrappe für Service-Tests: feste Seiten, aufgezeichnete Aufrufe. */
export function fakeTextExtraction(
  opts: { pages?: PageText[]; probe?: ProbeResult; onExtract?: (o: ExtractOptions) => void } = {},
): TextExtraction {
  return {
    probe: async () => opts.probe ?? { ok: true, languages: ['deu', 'eng'] },
    extract: async (o) => {
      opts.onExtract?.(o);
      return opts.pages ?? [{ page: 1, text: 'Beispieltext', source: 'layer' }];
    },
  };
}
