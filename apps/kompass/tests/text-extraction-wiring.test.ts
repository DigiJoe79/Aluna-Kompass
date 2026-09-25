import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

describe('Texterkennung ist verpackt', () => {
  it('das Image bringt Tesseract, die Sprachdaten und Poppler mit', () => {
    const dockerfile = read('Dockerfile');

    for (const pkg of ['tesseract-ocr', 'tesseract-ocr-deu', 'tesseract-ocr-eng', 'poppler-utils']) {
      expect(dockerfile).toContain(pkg);
    }
  });

  it('jedes Binary, das die Umsetzung aufruft, kommt aus einem Paket des Images und der CI', () => {
    // Welches Debian-Paket welches Binary mitbringt. Ruft `@kompass/text-extraction`
    // ein Werkzeug auf, das hier fehlt, fällt es auf — bevor es im Container fehlt.
    const packageOf: Record<string, string> = {
      pdftotext: 'poppler-utils',
      pdftoppm: 'poppler-utils',
      pdfdetach: 'poppler-utils',
      tesseract: 'tesseract-ocr',
    };
    const srcDir = 'packages/text-extraction/src';
    const called = new Set(
      readdirSync(path.join(root, srcDir))
        .filter((f) => f.endsWith('.ts'))
        .flatMap((f) => [...read(`${srcDir}/${f}`).matchAll(/'(pdf[a-z]+|tesseract)'/g)].map((m) => m[1]!)),
    );

    expect([...called].sort()).toEqual(['pdfdetach', 'pdftoppm', 'pdftotext', 'tesseract']);
    const dockerfile = read('Dockerfile');
    const ci = read('.github/workflows/ci.yml');
    for (const bin of called) {
      expect(packageOf[bin], bin).toBeDefined();
      expect(dockerfile).toContain(packageOf[bin]!);
      expect(ci).toContain(packageOf[bin]!);
    }
  });

  it('das neue Paket wird von Next übersetzt', () => {
    expect(read('apps/kompass/next.config.ts')).toContain('@kompass/text-extraction');
  });

  it('die Anwendung setzt die echte Umsetzung ein, nicht die Attrappe', () => {
    const deps = read('apps/kompass/src/lib/deps.ts');

    expect(deps).toContain('createTextExtraction');
    expect(deps).not.toContain('noopTextExtraction');
  });

  it('die CI installiert die Werkzeuge vor dem E2E-Lauf', () => {
    expect(read('.github/workflows/ci.yml')).toContain('tesseract-ocr-deu');
  });
});
