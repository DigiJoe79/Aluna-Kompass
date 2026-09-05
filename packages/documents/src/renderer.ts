import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTypst, findTypstBinary, typstVersion } from './typst';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface TypstRenderer {
  render(templateFile: string, payload: unknown, logo?: { bytes: Uint8Array; mimeType: string } | null): Promise<Uint8Array>;
  version(): Promise<string>;
}

const LOGO_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' };

/** Im Container-Bundle zeigt import.meta.url nicht auf die Paketdateien; dann setzen die Container KOMPASS_TEMPLATES_DIR und KOMPASS_FONTS_DIR. */
export function resolveAssetDirs(env: Record<string, string | undefined> = process.env): { templatesDir: string; fontsDir: string } {
  return {
    templatesDir: env.KOMPASS_TEMPLATES_DIR ?? path.join(PACKAGE_DIR, 'templates'),
    fontsDir: env.KOMPASS_FONTS_DIR ?? path.join(PACKAGE_DIR, 'fonts'),
  };
}

export function createTypstRenderer(opts: { binary?: string; templatesDir?: string; fontsDir?: string } = {}): TypstRenderer {
  const defaults = resolveAssetDirs();
  const templatesDir = opts.templatesDir ?? defaults.templatesDir;
  const fontsDir = opts.fontsDir ?? defaults.fontsDir;
  let binary: string | null = opts.binary ?? null;
  const bin = () => (binary ??= findTypstBinary());
  return {
    async version() {
      return typstVersion(bin());
    },
    async render(templateFile, payload, logo = null) {
      const job = await mkdtemp(path.join(tmpdir(), 'kompass-typst-'));
      try {
        await cp(templatesDir, path.join(job, 'templates'), { recursive: true });
        let logoFile: string | null = null;
        if (logo && LOGO_EXT[logo.mimeType]) {
          logoFile = `/logo.${LOGO_EXT[logo.mimeType]}`;
          await writeFile(path.join(job, logoFile.slice(1)), logo.bytes);
        }
        await writeFile(path.join(job, 'data.json'), JSON.stringify({ ...(payload as object), logoFile }));
        await compileTypst({ binary: bin(), rootDir: job, fontsDir, entry: path.join(job, 'templates', templateFile), output: path.join(job, 'out.pdf') });
        return new Uint8Array(await readFile(path.join(job, 'out.pdf')));
      } finally {
        await rm(job, { recursive: true, force: true });
      }
    },
  };
}
