import { coreModule } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { countDocumentText, removeDocumentText, replaceDocumentText } from '../src/index-store';
import { dmsModule } from '../src/manifest';

const setup = () => createTestDeps({ manifests: [coreModule, dmsModule] });

describe('Textindex', () => {
  it('schreibt eine Zeile je Seite', () => {
    const deps = setup();

    replaceDocumentText(deps, 'DOC-1', [
      { page: 1, text: 'Tierarztrechnung 2026-4711' },
      { page: 2, text: 'Impfung und Kastration' },
    ]);

    expect(countDocumentText(deps, 'DOC-1')).toBe(2);
  });

  it('ersetzt statt anzuhängen — zweimal lesen ergibt denselben Bestand', () => {
    const deps = setup();
    const pages = [{ page: 1, text: 'Tierarztrechnung' }];

    replaceDocumentText(deps, 'DOC-1', pages);
    replaceDocumentText(deps, 'DOC-1', pages);

    expect(countDocumentText(deps, 'DOC-1')).toBe(1);
  });

  it('räumt die Zeilen eines Dokuments weg, ohne andere anzufassen', () => {
    const deps = setup();
    replaceDocumentText(deps, 'DOC-1', [{ page: 1, text: 'eins' }]);
    replaceDocumentText(deps, 'DOC-2', [{ page: 1, text: 'zwei' }]);

    removeDocumentText(deps, 'DOC-1');

    expect(countDocumentText(deps, 'DOC-1')).toBe(0);
    expect(countDocumentText(deps, 'DOC-2')).toBe(1);
  });

  it('findet ein Kompositum über seinen zweiten Teil', () => {
    const deps = setup();
    replaceDocumentText(deps, 'DOC-1', [{ page: 1, text: 'Tierarztrechnung vom 14. Oktober' }]);

    const hit = deps.sqlite
      .prepare(`SELECT document_id FROM document_text WHERE document_text MATCH ?`)
      .get('"rechnung"');

    expect(hit).toMatchObject({ document_id: 'DOC-1' });
  });

  it('faltet Umlaute, damit „katzin“ die „Kätzin“ findet', () => {
    const deps = setup();
    replaceDocumentText(deps, 'DOC-1', [{ page: 1, text: 'Die Kätzin Bärbel' }]);

    const hit = deps.sqlite
      .prepare(`SELECT document_id FROM document_text WHERE document_text MATCH ?`)
      .get('"katzin"');

    expect(hit).toMatchObject({ document_id: 'DOC-1' });
  });
});
