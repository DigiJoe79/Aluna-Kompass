import { describe, expect, it } from 'vitest';
import { buttonVariants } from '@/components/ui/button';
import { matchingLines, read, sourceFiles } from './source';

/**
 * Eine sekundäre Stufe (Designer Runde 3, Teil 1 Nr. 1, 044; docs/MUSTER.md § B, Knopfstufen): Es gibt nur `outline`,
 * auch auf den Kachelknöpfen der Startseite. Das grau gefüllte `secondary` entfällt — zwei Arten sekundärer Knöpfe
 * standen ohne erkennbare Regel nebeneinander („Status ändern“ grau, „Als PDF“ mit Rand).
 */
const SECONDARY = /variant(?:=\{?|:\s*)["']secondary["']|variant=\{[^}]*["']secondary["']/;

describe('eine sekundäre Knopfstufe', () => {
  it('kein Knopf mit `secondary`', () => {
    expect(sourceFiles().flatMap((file) => matchingLines(file, read(file), SECONDARY))).toEqual([]);
  });

  it('der Baustein kennt `secondary` nicht mehr', () => {
    // @ts-expect-error — die Stufe gibt es nicht mehr (der Typecheck hält das fest), und sie trägt keine Fläche.
    expect(buttonVariants({ variant: 'secondary' })).not.toContain('bg-surface-2');
  });
});
