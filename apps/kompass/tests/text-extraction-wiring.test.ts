import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

/** Dass Next das Paket übersetzt, prüft `transpile-packages.test.ts` für jede `@kompass`-Abhängigkeit der App. */
describe('Texterkennung ist verpackt', () => {
  it('Image und CI (vor dem E2E-Lauf) bringen Tesseract, die Sprachdaten und Poppler mit', () => {
    const dockerfile = read('Dockerfile');
    const ci = read('.github/workflows/ci.yml');

    for (const pkg of ['tesseract-ocr', 'tesseract-ocr-deu', 'tesseract-ocr-eng', 'poppler-utils']) {
      expect(dockerfile, pkg).toContain(pkg);
      expect(ci, pkg).toContain(pkg);
    }
  });

  it('jedes Binary, das die Umsetzung aufruft, kommt aus einem Paket des Images und der CI', () => {
    // Welches Debian-Paket welches Binary mitbringt. Ruft `@kompass/text-extraction`
    // ein Werkzeug auf, das hier fehlt, fällt es auf — bevor es im Container fehlt.
    const packageOf: Record<string, string> = {
      pdftotext: 'poppler-utils',
      pdftoppm: 'poppler-utils',
      pdfdetach: 'poppler-utils',
      pdfunite: 'poppler-utils',
      tesseract: 'tesseract-ocr',
    };
    const srcDir = 'packages/text-extraction/src';
    const called = new Set(
      readdirSync(path.join(root, srcDir))
        .filter((f) => f.endsWith('.ts'))
        .flatMap((f) => [...read(`${srcDir}/${f}`).matchAll(/'(pdf[a-z]+|tesseract)'/g)].map((m) => m[1]!)),
    );

    expect([...called].sort()).toEqual(['pdfdetach', 'pdftoppm', 'pdftotext', 'pdfunite', 'tesseract']);
    const dockerfile = read('Dockerfile');
    const ci = read('.github/workflows/ci.yml');
    for (const bin of called) {
      expect(packageOf[bin], bin).toBeDefined();
      expect(dockerfile).toContain(packageOf[bin]!);
      expect(ci).toContain(packageOf[bin]!);
    }
  });

  it('die Anwendung setzt die echte Umsetzung ein, nicht die Attrappe', () => {
    const deps = read('apps/kompass/src/lib/deps.ts');

    expect(deps).toContain('createTextExtraction');
    expect(deps).not.toContain('noopTextExtraction');
    // Sammel-PDFs (Finanzen F6b): ohne diese Zeile fiele `deps.pdf` auf die Attrappe, die wirft.
    expect(deps).toContain('pdf: createPdfTools()');
    expect(deps).not.toContain('noopPdfTools');
  });
});
