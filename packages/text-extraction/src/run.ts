import { execFile } from 'node:child_process';

/**
 * Ein externes Werkzeug aufrufen, mit Zeitlimit und lesbarem Fehler. Die
 * Ausgabe kommt binär zurück, weil `pdftoppm` Bilder liefert.
 *
 * Fehlt das Binary, ist das keine Ausnahme im Fachsinn, sondern eine Aussage
 * über die Umgebung — der Aufrufer übersetzt sie in `unavailable`.
 */
export class ToolMissingError extends Error {}
export class ToolTimeoutError extends Error {}

export function runTool(
  bin: string,
  args: string[],
  opts: { input?: Uint8Array; timeoutMs: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      args,
      { timeout: opts.timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout as Buffer);
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return reject(new ToolMissingError(`${bin} ist nicht installiert`));
        if ((error as { killed?: boolean }).killed) {
          return reject(new ToolTimeoutError(`${bin} überschritt ${opts.timeoutMs} ms`));
        }
        return reject(new Error(`${bin} scheiterte: ${stderr.toString().slice(0, 400)}`));
      },
    );
    if (opts.input) {
      child.stdin?.end(Buffer.from(opts.input));
    }
  });
}
