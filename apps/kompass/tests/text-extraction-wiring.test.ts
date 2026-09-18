import { readFileSync } from 'node:fs';
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
