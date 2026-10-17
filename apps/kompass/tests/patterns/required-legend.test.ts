import { describe, expect, it } from 'vitest';
import { matchingLines, read, sourceFiles } from './source';

/**
 * Stern ⇔ Fußhinweis (Designer Runde 3: 034, 040, 094, 186, 188; docs/MUSTER.md § B): „* Pflichtfeld“ setzt nur die
 * Speicherleiste, und zwar genau dann, wenn darüber ein Feld einen Stern trägt (`FormField required` → `Label required`).
 * Eine Aufrufstelle schreibt die Legende nie selbst als Notiz — sonst stand sie über Formularen ohne Stern (034, 186).
 */
describe('Pflichtfeld-Legende nur aus der Speicherleiste', () => {
  it('kein `requiredLegend` außerhalb von FormActionBar', () => {
    const hits = sourceFiles()
      .filter((file) => !file.endsWith('components/forms/form-action-bar.tsx'))
      .flatMap((file) => matchingLines(file, read(file), /requiredLegend/));
    expect(hits).toEqual([]);
  });
});
