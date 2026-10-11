import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { openingTags, read, relative, sourceFiles, SRC } from './patterns/source';

/**
 * `ForbiddenCard` und `ModuleInactiveCard` tragen das `h1` (Spec Charge 3 § 3.2): Sie ersetzen den Seiteninhalt.
 * Stünde eine unter einem `PageHeader`, gäbe es zwei `h1` — `one-h1` sähe das nicht. Geprüft wird: Die Karte
 * steht nie in einem `<Page …>` mit `header`.
 */
describe('Sperrkarten stehen ohne Seitentitel', () => {
  it('kein <Page header=…> um ForbiddenCard/ModuleInactiveCard', () => {
    const files = [path.join(SRC, 'app'), path.join(SRC, 'components')].flatMap((dir) => sourceFiles(dir));
    const bad = files.flatMap((file) => {
      const text = read(file);
      if (!/<(ForbiddenCard|ModuleInactiveCard)\b/.test(text)) return [];
      return openingTags(text, /Page/)
        .filter(({ tag }) => /\sheader=/.test(tag))
        .filter(({ line }) => {
          const rest = text.split('\n').slice(line - 1, line + 2).join('\n');
          return /<(ForbiddenCard|ModuleInactiveCard)\b/.test(rest);
        })
        .map(({ line }) => `${relative(file)}:${line}`);
    });
    expect(bad).toEqual([]);
  });
});
