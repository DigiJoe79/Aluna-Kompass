import { describe, expect, it } from 'vitest';
import { openingTags, read, relative, sourceFiles } from './source';

/**
 * `FormActionBar hideDiscard` gibt es nur auf Prüfseiten: Die Maske ist vorbefüllt, und entschieden wird mit
 * Annehmen/Ablehnen — „Verwerfen“ stünde dort als vierte Wahl neben „Ablehnen“ (Freigabe Designer 2026-10-10). In
 * gewöhnlichen Formularen bleibt „Verwerfen“; dieser Wächter hält die Option an den Prüfseiten der Vorschläge.
 */
const ALLOWED = /^app\/\(shell\)\/animals\/proposals\/\[id\]\//;

export function hideDiscardUses(text: string): number[] {
  return openingTags(text, /FormActionBar/)
    .filter(({ tag }) => /\bhideDiscard\b/.test(tag))
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
});
