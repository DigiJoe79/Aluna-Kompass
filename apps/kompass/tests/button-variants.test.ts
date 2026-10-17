import { CONTRAST_PAIRS } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { buttonVariants } from '@/components/ui/button';

const DARK = '[:root[data-color-scheme=dark]_&]:';
const SHADCN = /\b(bg-primary|text-primary-foreground|bg-secondary|text-secondary-foreground|bg-muted|text-foreground|bg-background|border-border|bg-destructive|text-destructive|bg-input|border-input)\b/;

describe('buttonVariants', () => {
  it.each(['default', 'outline', 'ghost', 'destructive', 'link'] as const)('%s nutzt nur Theme-Klassen', (variant) => {
    expect(buttonVariants({ variant })).not.toMatch(SHADCN);
  });
  it('setzt 600', () => expect(buttonVariants()).toContain('font-semibold'));
});

// Knopfstufen (Designer Stufe 2 Nr. 3, Z3): Gesperrt ist die Fläche der eigenen Stufe, gedämpft, ohne Hover; Gefahr
// ist die volle rote Fläche. Die Schrift darauf ist `surface` — das Paar `color-error`/`surface` hält 4,5:1 in
// beiden Modi (`CONTRAST_PAIRS`), hell also helle Schrift auf Rot.
describe('Knopfstufen', () => {
  it.each(['default', 'outline', 'ghost', 'destructive'] as const)('%s gesperrt: eigene Fläche gedämpft, ohne Hover', (variant) => {
    const classes = buttonVariants({ variant });
    // Hell nie die Sperrfläche; dunkel nur der Primärknopf (Runde 4, Punkt 7, unten).
    expect(classes.split(/\s+/).filter((c) => !c.startsWith(DARK))).not.toContainEqual(expect.stringMatching(/disabled:bg-disabled|disabled:text-disabled-ink/));
    expect(classes).toContain('disabled:opacity-50');
    expect(classes).toContain('disabled:pointer-events-none');
  });
  it('Gefahr ist die volle Fläche mit Schrift in Flächenfarbe', () => {
    const classes = buttonVariants({ variant: 'destructive' });
    expect(classes).toMatch(/(^| )bg-error( |$)/);
    expect(classes).toMatch(/(^| )text-surface( |$)/);
    expect(classes).not.toContain('bg-error-bg');
    expect(CONTRAST_PAIRS).toContainEqual({ fg: 'color-error', bg: 'surface', minimum: 4.5 });
  });
});

// Runde 3, Punkt 7; Runde 4 Nachtrag (215, 216): Im Dunkeln ist der gesperrte Primärknopf nicht der gedämpfte
// Primärknopf, sondern ohne Deckkraft die Sperrfläche `disabled-bg` mit Schrift `disabled-ink` und Rand `line-strong`.
// Hell bleibt er die eigene Fläche, gedämpft.
describe('gesperrter Primärknopf im Dunkeln', () => {
  const DARK_DISABLED = ['opacity-100', 'bg-disabled', 'text-disabled-ink', 'border-line-strong'].map((c) => `${DARK}disabled:${c}`);
  it('`default` trägt dunkel Sperrfläche, Sperrschrift, Rand und volle Deckkraft', () => {
    const classes = buttonVariants({ variant: 'default' }).split(/\s+/);
    for (const c of DARK_DISABLED) expect(classes).toContain(c);
    expect(classes).toContain('disabled:opacity-50');
  });
  it('die anderen Stufen bleiben auch dunkel gedämpft', () => {
    for (const variant of ['outline', 'ghost', 'destructive', 'link'] as const) {
      const classes = buttonVariants({ variant });
      expect(classes).not.toContain(DARK);
    }
  });
});

// Runde 3, 019: Ein Link mit `className={buttonVariants({ variant: 'outline' })}` stand ohne Rand da — die Grundklasse
// `border-transparent` und `border-line-strong` der Stufe standen beide im Klassentext, das Stylesheet entschied für
// transparent. `buttonVariants` liefert deshalb schon zusammengeführte Klassen, wie `Button` sie bekommt.
describe('buttonVariants ohne widersprüchliche Klassen', () => {
  it('outline trägt nur die Randfarbe der Stufe', () => {
    const classes = buttonVariants({ variant: 'outline' }).split(/\s+/);
    expect(classes).toContain('border-line-strong');
    expect(classes).not.toContain('border-transparent');
  });
});
