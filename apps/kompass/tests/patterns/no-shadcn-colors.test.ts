import { describe, expect, it } from 'vitest';
import { read, relative, sourceFiles } from './source';

/**
 * Nur Tokens aus dem Theme (docs/MUSTER.md, „Seitenrahmen“): keine shadcn-Klassennamen wie `bg-primary`,
 * `bg-muted`, `text-destructive` oder `ring-ring`. Die Aliase stehen noch in `globals.css`, damit generierte
 * Komponenten übersetzen, aber im Quelltext gelten die eigenen Namen (`bg-brand`, `bg-surface-2`, `text-error`,
 * `ring-focus` …). `text-muted-ink` und Verwandte enden anders und treffen nicht.
 */
const SHADCN =
  /(?<![\w-])(?:bg|text|border|ring|outline|fill|stroke|from|to|via|divide|placeholder|decoration|accent|caret)-(?:primary|primary-foreground|secondary|secondary-foreground|muted|muted-foreground|foreground|background|destructive|accent|accent-foreground|input|border|ring|popover|popover-foreground|card|card-foreground)(?:\/[0-9]+)?(?![\w-])/;

describe('keine shadcn-Farbnamen', () => {
  it('Klassen nennen nur Theme-Tokens', () => {
    const violations = sourceFiles().flatMap((file) =>
      read(file)
        .split('\n')
        .flatMap((line, index) => (SHADCN.test(line) ? [`${relative(file)}:${index + 1}`] : [])),
    );
    expect(violations).toEqual([]);
  });
});
