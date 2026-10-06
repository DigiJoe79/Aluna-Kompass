import { describe, expect, it } from 'vitest';
import { read, relative, sourceFiles, matchingLines } from './source';

/**
 * Eine klebende Leiste am unteren Rand gibt es zweimal: die Speicherleiste (`FormActionBar`) und die
 * Leiste der Mehrfachauswahl (`SelectionBar`). Bis 0.2.5 hatten Formulare und Listen sieben eigene
 * (docs/MUSTER.md § B und § G); jede war ein eigener Ort, an dem das Telefon, der Dialogrand oder die
 * Live-Region anders ausfiel.
 */
const ALLOWED = new Set(['components/forms/form-action-bar.tsx', 'components/selection-bar.tsx']);
const STICKY_BOTTOM = /\bsticky\b[^"'`]*\bbottom-0\b|\bbottom-0\b[^"'`]*\bsticky\b/;

describe('keine eigene klebende Leiste', () => {
  it('sticky bottom-0 steht nur in FormActionBar und SelectionBar', () => {
    const violations = sourceFiles()
      .filter((file) => !ALLOWED.has(relative(file)))
      .flatMap((file) => matchingLines(file, read(file), STICKY_BOTTOM));
    expect(violations).toEqual([]);
  });

  it('beide Leisten kleben tatsächlich', () => {
    const using = sourceFiles().filter((file) => STICKY_BOTTOM.test(read(file))).map(relative);
    expect([...ALLOWED].filter((file) => !using.includes(file))).toEqual([]);
  });
});
