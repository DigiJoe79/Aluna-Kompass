import { describe, expect, it } from 'vitest';
import { openingTags, read, relative, sourceFiles } from './source';

/**
 * `FormActionBar hideDiscard` gibt es nur auf Prüfseiten: Die Maske ist vorbefüllt, und entschieden wird mit
 * Annehmen/Ablehnen — „Verwerfen“ stünde dort als vierte Wahl neben „Ablehnen“ (Freigabe Designer 2026-10-10). In
 * gewöhnlichen Formularen erscheint „Verwerfen“ nur mit Änderungen; dieser Wächter hält die Option an den Prüfseiten der
 * Vorschläge und das Gegenstück `alwaysDiscard` an der Buchungsmaske.
 */
const ALLOWED = /^app\/\(shell\)\/animals\/proposals\/\[id\]\//;
/** `alwaysDiscard` nur in der Buchungsmaske: Sie behält ihre fünf Aktionen (Designer 2026-10-16, Teil 2 Nr. 1). */
const ALWAYS_ALLOWED = /^app\/\(shell\)\/finance\/entries\/entry-form\.tsx$/;

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
  it('alwaysDiscard steht nur in der Buchungsmaske', () => {
    const files = sourceFiles();
    const outside = files
      .filter((file) => !ALWAYS_ALLOWED.test(relative(file)))
      .flatMap((file) => hideDiscardUses(read(file), 'alwaysDiscard').map((line) => `${relative(file)}:${line}`));
    expect(outside).toEqual([]);
    expect(files.filter((file) => ALWAYS_ALLOWED.test(relative(file))).flatMap((file) => hideDiscardUses(read(file), 'alwaysDiscard'))).toHaveLength(1);
  });
});
