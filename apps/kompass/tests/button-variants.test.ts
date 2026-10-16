import { CONTRAST_PAIRS } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { buttonVariants } from '@/components/ui/button';

const SHADCN = /\b(bg-primary|text-primary-foreground|bg-secondary|text-secondary-foreground|bg-muted|text-foreground|bg-background|border-border|bg-destructive|text-destructive|bg-input|border-input)\b/;

describe('buttonVariants', () => {
  it.each(['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const)('%s nutzt nur Theme-Klassen', (variant) => {
    expect(buttonVariants({ variant })).not.toMatch(SHADCN);
  });
  it('setzt 600', () => expect(buttonVariants()).toContain('font-semibold'));
});

// Knopfstufen (Designer Stufe 2 Nr. 3, Z3): Gesperrt ist die Fläche der eigenen Stufe, gedämpft, ohne Hover; Gefahr
// ist die volle rote Fläche. Die Schrift darauf ist `surface` — das Paar `color-error`/`surface` hält 4,5:1 in
// beiden Modi (`CONTRAST_PAIRS`), hell also helle Schrift auf Rot.
describe('Knopfstufen', () => {
  it.each(['default', 'outline', 'secondary', 'ghost', 'destructive'] as const)('%s gesperrt: eigene Fläche gedämpft, ohne Hover', (variant) => {
    const classes = buttonVariants({ variant });
    expect(classes).not.toMatch(/disabled:bg-disabled|disabled:text-disabled-ink/);
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
