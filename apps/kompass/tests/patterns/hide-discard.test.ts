import { describe, expect, it } from 'vitest';
import { openingTags, read, relative, sourceFiles } from './source';

/**
 * `FormActionBar hideDiscard` gibt es nur auf Prüfseiten: Die Maske ist vorbefüllt, und entschieden wird mit
 * Annehmen/Ablehnen — „Verwerfen“ stünde dort als vierte Wahl neben „Ablehnen“ (Freigabe Designer 2026-10-10). In
 * gewöhnlichen Formularen erscheint „Verwerfen“ nur mit Änderungen; dieser Wächter hält die Option an den Prüfseiten der
 * Vorschläge. Das Gegenstück `alwaysDiscard` der Buchungsmaske ist entfallen (Runde 3, 087, 091): Auch dort gilt
 * „Verwerfen nur mit Änderung, beim Anlegen nur Abbrechen“.
 */
const ALLOWED = /^app\/\(shell\)\/animals\/proposals\/\[id\]\//;

export function hideDiscardUses(text: string, option: 'hideDiscard' | 'alwaysDiscard' = 'hideDiscard'): number[] {
  return openingTags(text, /FormActionBar/)
    .filter(({ tag }) => new RegExp(`\\b${option}\\b`).test(tag))
    .map(({ line }) => line);
}

describe('FormActionBar hideDiscard', () => {
  it('erkennt die Option im Tag', () => {
    expect(hideDiscardUses('<FormActionBar mode="create" hideDiscard />')).toEqual([1]);
    expect(hideDiscardUses('<FormActionBar mode="create" />')).toEqual([]);
  });
  it('steht nur auf den Prüfseiten der Vorschläge', () => {
    const outside = sourceFiles()
      .filter((file) => !ALLOWED.test(relative(file)))
      .flatMap((file) => hideDiscardUses(read(file)).map((line) => `${relative(file)}:${line}`));
    expect(outside).toEqual([]);
  });
  it('alwaysDiscard gibt es nicht mehr, auch nicht in der Buchungsmaske (087)', () => {
    expect(sourceFiles().flatMap((file) => hideDiscardUses(read(file), 'alwaysDiscard').map((line) => `${relative(file)}:${line}`))).toEqual([]);
  });
});
