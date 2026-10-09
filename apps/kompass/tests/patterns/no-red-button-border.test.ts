import { describe, expect, it } from 'vitest';
import { callArguments, openingTags, read, relative, sourceFiles } from './source';

/**
 * Lösch- und Stornoknöpfe auf der Seite sind neutral (docs/MUSTER.md § C): ein schlichtes `outline` bzw. ein
 * Eintrag in „Weitere Aktionen“ (`RecordActions`). Rot ergibt erst im Bestätigungsdialog Sinn (`destructive`) — und gesperrt wäre
 * ein roter Rahmen irreführend. Gefunden wird `border-error` im Tag eines `<Button` und in
 * `buttonVariants(…)`; Rahmen von Meldungen, Feldern und Karten bleiben unberührt.
 */
/** `border-error` (Rahmen) und `text-error` (Schrift); `hover:text-error` o. ä. zählt mit. */
const RED = /(?<![\w-])(?:[a-z-]+:)*(?:border|text)-error(?![\w-])/;

describe('kein roter Rahmen an Knöpfen', () => {
  it('<Button> und buttonVariants() tragen kein border-error und kein text-error', () => {
    const violations = sourceFiles().flatMap((file) => {
      const text = read(file);
      const tags = openingTags(text, /Button/).filter(({ tag }) => RED.test(tag));
      const calls = callArguments(text, 'buttonVariants(').filter(({ args }) => RED.test(args));
      return [...tags, ...calls].map(({ line }) => `${relative(file)}:${line}`);
    });
    expect(violations).toEqual([]);
  });
});
