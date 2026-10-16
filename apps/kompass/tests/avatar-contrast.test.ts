import { CONTRAST_PAIRS, contrastRatio, DEFAULT_THEME } from '@kompass/core';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Avatar im Nutzermenü: Schrift ≥ 4,5:1 in allen mitgelieferten Themes, hell und dunkel (Designer 2026-10-16, Teil 3
 * Nr. 1; 01 A4). Der Avatar trägt `bg-brand text-on-brand`, also die Tokens `color-primary` und `on-primary`.
 */
describe('Avatar-Kontrast', () => {
  const SHIPPED = [DEFAULT_THEME];

  it('der Avatar nimmt die geprüften Tokens', () => {
    const source = readFileSync(path.join(__dirname, '../src/components/shell/user-menu.tsx'), 'utf8');
    expect(source).toMatch(/rounded-full bg-brand [^"]*text-on-brand/);
    expect(CONTRAST_PAIRS).toContainEqual({ fg: 'on-primary', bg: 'color-primary', minimum: 4.5 });
  });

  it.each(SHIPPED.flatMap((theme) => (['light', 'dark'] as const).map((mode) => [theme.key, mode, theme] as const)))('%s %s ≥ 4,5:1', (_key, mode, theme) => {
    expect(contrastRatio(theme.tokens['on-primary'][mode], theme.tokens['color-primary'][mode])).toBeGreaterThanOrEqual(4.5);
  });
});
