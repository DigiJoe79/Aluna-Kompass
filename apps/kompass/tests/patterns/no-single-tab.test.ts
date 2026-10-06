import { describe, expect, it } from 'vitest';
import { read, relative, sourceFiles } from './source';

/**
 * Reiter gibt es erst ab zwei (docs/MUSTER.md § E): Ein einziger Reiter ist ein Abschnitt mit
 * Überschrift, kein Navigationsmittel — das Projektformular trug bis 0.2.5 einen einzelnen Reiter
 * „Webseite“. Statisch gezählt wird `<TabsTrigger` je Datei.
 */
describe('keine Reiterleiste mit einem Reiter', () => {
  it('jede Datei mit Reitern hat mindestens zwei', () => {
    const violations = sourceFiles().flatMap((file) => {
      const count = (read(file).match(/<TabsTrigger\b/g) ?? []).length;
      return count === 1 ? [relative(file)] : [];
    });
    expect(violations).toEqual([]);
  });
});
