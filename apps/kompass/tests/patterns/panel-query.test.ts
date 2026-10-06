import { describe, expect, it } from 'vitest';
import { matchingLines, read, relative, sourceFiles } from './source';

/**
 * Der Bereich einer Einstellungsseite steht in der Adresse (`?panel=`), und den Weg dorthin kennt nur
 * `components/panel-nav.tsx` (`panelHref`, docs/MUSTER.md § D). Bis 0.2.5 bauten drei Stellen die Adresse
 * von Hand zusammen und bogen sie beim Umbenennen eines Bereichs nicht mit. Kommentare dürfen das Muster
 * nennen.
 */
describe('?panel= nur im PanelNav', () => {
  it('kein anderer Code baut eine Panel-Adresse', () => {
    const violations = sourceFiles()
      .filter((file) => relative(file) !== 'components/panel-nav.tsx')
      .flatMap((file) => matchingLines(file, read(file), /\?panel=/));
    expect(violations).toEqual([]);
  });
});
