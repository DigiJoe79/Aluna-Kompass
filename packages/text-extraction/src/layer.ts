import { runTool } from './run';

/** `pdftotext` trennt Seiten mit dem Seitenvorschub 0x0C. */
const PAGE_BREAK = '\f';

/**
 * Liest die Textebene eines PDFs, je Seite ein Eintrag. Ein Scan liefert hier
 * leere Zeichenketten — das ist kein Fehler, sondern die Auskunft, dass diese
 * Seiten erkannt werden müssen.
 */
export async function readTextLayer(bytes: Uint8Array, timeoutMs: number): Promise<string[]> {
  const out = await runTool('pdftotext', ['-layout', '-', '-'], { input: bytes, timeoutMs });
  const pages = out.toString('utf8').split(PAGE_BREAK);
  // Der letzte Seitenvorschub steht am Dateiende und erzeugt einen leeren Rest.
  if (pages.length > 1 && pages[pages.length - 1]!.trim() === '') pages.pop();
  return pages;
}
