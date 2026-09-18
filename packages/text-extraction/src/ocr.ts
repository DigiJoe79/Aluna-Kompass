import { runTool } from './run';

/**
 * Eine einzelne Seite erkennen: erst als Bitmap rendern, dann durch Tesseract.
 * 300 dpi ist der Wert, bei dem Tesseract für Fließtext ausgelegt ist; darunter
 * leidet die Trefferquote, darüber wächst nur die Rechenzeit.
 */
export async function ocrPage(
  bytes: Uint8Array,
  page: number,
  languages: string[],
  timeoutMs: number,
): Promise<string> {
  const png = await runTool(
    'pdftoppm',
    ['-png', '-r', '300', '-f', String(page), '-l', String(page), '-singlefile', '-'],
    { input: bytes, timeoutMs },
  );
  // `stdin`/`stdout` als `-`: Tesseract schreibt reinen Text nach stdout.
  const out = await runTool('tesseract', ['stdin', 'stdout', '-l', languages.join('+')], {
    input: png,
    timeoutMs,
  });
  return out.toString('utf8');
}
