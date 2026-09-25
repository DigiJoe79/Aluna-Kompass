import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCUMENT_IMAGE_KEY, documentImageExtension } from '@kompass/core';
import { compileTypst, findTypstBinary, typstVersion } from './typst';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LOGO_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' };

export interface RenderDocumentOptions {
  baseId: string;
  /** Alle auflösbaren Basen — die gewählte plus jene, die sie per `#import` braucht. */
  bases: ReadonlyMap<string, { id: string; typst: string }>;
  /** Typst-Content-Markup (aus Markdown gewandelt oder direkt vom Modul). */
  bodyTypst: string;
  /** Wird als data.json unter dem Root abgelegt; `slots` erwartet. */
  payload: object;
  logo?: { bytes: Uint8Array; mimeType: string } | null;
  /** Zusätzliche `--font-path`-Verzeichnisse (z. B. `<volume>/fonts`). */
  fontPaths?: string[];
  /** Wird als `assets/` in den Job kopiert — Basen greifen mit `#image("assets/…")` zu. */
  assetsDir?: string | null;
  /** Bilder des Körpers; landen als `/images/<key>.<png|jpg>` im Job (Endung aus den Magic Bytes). */
  images?: Record<string, { bytes: Uint8Array; checksum: string }>;
}

export interface TypstRenderer {
  renderDocument(opts: RenderDocumentOptions): Promise<Uint8Array>;
  version(): Promise<string>;
}

/** Im Container-Bundle zeigt import.meta.url nicht auf die Paketdateien; dann setzen die Container KOMPASS_TEMPLATES_DIR und KOMPASS_FONTS_DIR. */
export function resolveAssetDirs(env: Record<string, string | undefined> = process.env): {
  templatesDir: string;
  fontsDir: string;
  documentTemplatesDir: string | null;
} {
  return {
    templatesDir: env.KOMPASS_TEMPLATES_DIR ?? path.join(PACKAGE_DIR, 'templates'),
    fontsDir: env.KOMPASS_FONTS_DIR ?? path.join(PACKAGE_DIR, 'fonts'),
    documentTemplatesDir: env.KOMPASS_DOCUMENT_TEMPLATES_DIR ?? null,
  };
}

export function createTypstRenderer(opts: { binary?: string; fontsDir?: string } = {}): TypstRenderer {
  const fontsDir = opts.fontsDir ?? resolveAssetDirs().fontsDir;
  let binary: string | null = opts.binary ?? null;
  const bin = () => (binary ??= findTypstBinary());
  return {
    async version() {
      return typstVersion(bin());
    },
    async renderDocument({ baseId, bases, bodyTypst, payload, logo = null, fontPaths = [], assetsDir = null, images = {} }) {
      if (!bases.has(baseId)) throw new Error(`unknown document base: ${baseId}`);
      const imageFiles = Object.entries(images).map(([key, image]) => {
        const ext = documentImageExtension(image.bytes);
        if (!DOCUMENT_IMAGE_KEY.test(key) || !ext) throw new Error(`invalid document image: ${key}`);
        return { name: `${key}.${ext}`, bytes: image.bytes };
      });
      const job = await mkdtemp(path.join(tmpdir(), 'kompass-doc-'));
      try {
        await mkdir(path.join(job, 'bases'), { recursive: true });
        for (const base of bases.values()) {
          await writeFile(path.join(job, 'bases', `${base.id}.typ`), base.typst);
        }
        if (assetsDir && existsSync(assetsDir)) {
          await cp(assetsDir, path.join(job, 'assets'), { recursive: true });
        }
        if (imageFiles.length > 0) {
          await mkdir(path.join(job, 'images'), { recursive: true });
          for (const file of imageFiles) await writeFile(path.join(job, 'images', file.name), file.bytes);
        }
        let logoFile: string | null = null;
        if (logo && LOGO_EXT[logo.mimeType]) {
          logoFile = `/logo.${LOGO_EXT[logo.mimeType]}`;
          await writeFile(path.join(job, logoFile.slice(1)), logo.bytes);
        }
        await writeFile(path.join(job, 'body.typ'), `#let content = [\n${bodyTypst}\n]\n`);
        await writeFile(path.join(job, 'data.json'), JSON.stringify({ ...payload, logoFile }));
        await writeFile(
          path.join(job, 'entry.typ'),
          `#import "bases/${baseId}.typ": base\n#import "body.typ": content\n#let payload = json("/data.json")\n#show: base.with(payload, payload.slots)\n#content\n`,
        );
        await compileTypst({
          binary: bin(),
          rootDir: job,
          fontPaths: [fontsDir, ...fontPaths.filter((p) => existsSync(p))],
          entry: path.join(job, 'entry.typ'),
          output: path.join(job, 'out.pdf'),
        });
        return new Uint8Array(await readFile(path.join(job, 'out.pdf')));
      } finally {
        await rm(job, { recursive: true, force: true });
      }
    },
  };
}
