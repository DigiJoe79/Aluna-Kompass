import type { PageText, ProbeResult, TextExtraction } from '@kompass/core';
import { readTextLayer } from './layer';
import { ocrPage } from './ocr';
import { runTool, ToolMissingError } from './run';

/**
 * Unter so vielen Zeichen gilt eine Seite als Bild. Der Wert beschreibt eine
 * Eigenschaft von PDFs, kein Vereinsspezifikum — deshalb Konstante und keine
 * Einstellung (Spec § 6). Ein Deckblatt mit Briefkopf und Betreff liegt
 * darüber, eine Scanseite mit Seitenzahl in der Fußzeile darunter.
 */
export const LAYER_MIN_CHARS = 100;
export const PAGE_TIMEOUT_MS = 30_000;
export const DOCUMENT_TIMEOUT_MS = 600_000;

function parseLanguages(out: string): string[] {
  // `tesseract --list-langs` schreibt eine Kopfzeile, dann je Zeile ein Kuerzel.
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.includes(' '));
}

/**
 * Wie lange die Antwort von `probe()` gilt. Sie kostet zwei Prozessstarts und
 * ändert sich zwischen zwei Dokumenten nicht — bei „Alles neu lesen“ über
 * tausend Dokumente wären es zweitausend. Kurz genug bleibt die Frist trotzdem,
 * damit frisch installierte Werkzeuge innerhalb eines Worker-Taktes auffallen.
 */
export const PROBE_TTL_MS = 60_000;

export function createTextExtraction(): TextExtraction {
  let cached: { at: number; result: ProbeResult } | null = null;

  return {
    async probe(): Promise<ProbeResult> {
      if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.result;

      const result = await (async (): Promise<ProbeResult> => {
        try {
          await runTool('pdftotext', ['-v'], { timeoutMs: 5_000 });
          const langs = await runTool('tesseract', ['--list-langs'], { timeoutMs: 10_000 });
          return { ok: true, languages: parseLanguages(langs.toString('utf8')) };
        } catch (error) {
          if (error instanceof ToolMissingError) return { ok: false, error: error.message };
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      })();

      cached = { at: Date.now(), result };
      return result;
    },

    async extract({ bytes, languages }): Promise<PageText[]> {
      const started = Date.now();
      const layer = await readTextLayer(bytes, PAGE_TIMEOUT_MS);
      const pages: PageText[] = [];

      for (const [index, text] of layer.entries()) {
        const page = index + 1;
        if (text.trim().length >= LAYER_MIN_CHARS) {
          pages.push({ page, text, source: 'layer' });
          continue;
        }
        if (Date.now() - started > DOCUMENT_TIMEOUT_MS) {
          throw new Error(`Erkennung überschritt das Zeitlimit bei Seite ${page}`);
        }
        pages.push({ page, text: await ocrPage(bytes, page, languages, PAGE_TIMEOUT_MS), source: 'ocr' });
      }

      return pages;
    },
  };
}
