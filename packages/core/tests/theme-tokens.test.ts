import { describe, expect, it } from 'vitest';
import { CONTRAST_PAIRS, checkThemeContrast } from '../src/themes/contrast';
import { DEFAULT_THEME } from '../src/themes/default-theme';
import { themeTokensSchema } from '../src/themes/tokens';

/**
 * Ein Token-Wert landet als CSS-Deklaration im `<style>` des Wurzel-Layouts.
 * Steht darin eine geschweifte Klammer oder ein Semikolon, bricht er aus
 * seiner Deklaration aus — und weil das Layout auf **jeder** Seite liegt,
 * nähme er die Oberfläche mit, einschließlich der Themes-Seite, über die man
 * ihn zurücknehmen würde. Geprüft wird deshalb beim Schreiben, nicht erst
 * beim Rendern.
 */
const mitWert = (wert: string) => ({ ...DEFAULT_THEME.tokens, bg: { light: wert, dark: '#000' } });

describe('theme token values', () => {
  it('takes what a colour, a font stack or a radius needs', () => {
    for (const wert of ['#2F5D68', 'rgb(47, 93, 104)', 'oklch(0.7 0.1 200)', '"Inter", system-ui, sans-serif', '0.5rem', '9999px', '0 1px 2px rgba(0,0,0,.08)']) {
      expect(themeTokensSchema.safeParse(mitWert(wert)).success, wert).toBe(true);
    }
  });

  it('refuses what would break out of the declaration', () => {
    for (const wert of ['#fff}body{color:red', '#fff;color:red', '#fff<script>', 'red>']) {
      expect(themeTokensSchema.safeParse(mitWert(wert)).success, wert).toBe(false);
    }
  });

  it('still refuses the empty value and the overly long one', () => {
    expect(themeTokensSchema.safeParse(mitWert('')).success).toBe(false);
    expect(themeTokensSchema.safeParse(mitWert('#'.repeat(161))).success).toBe(false);
  });

  it('carries the seven finance tokens in the default theme, light and dark', () => {
    for (const token of ['color-final', 'color-final-bg', 'color-agent', 'color-agent-bg', 'color-amount-out', 'color-key-bg', 'color-key-ink'] as const) {
      expect(DEFAULT_THEME.tokens[token].light).toMatch(/^#[0-9A-F]{6}$/i);
      expect(DEFAULT_THEME.tokens[token].dark).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('checks the new ink/surface pairs for contrast', () => {
    const pairs = CONTRAST_PAIRS.map((p) => `${p.fg}/${p.bg}`);
    expect(pairs).toEqual(expect.arrayContaining(['color-final/color-final-bg', 'color-agent/color-agent-bg', 'color-amount-out/surface', 'color-amount-out/table-zebra', 'color-key-ink/color-key-bg']));
    expect(checkThemeContrast(DEFAULT_THEME)).toEqual([]);
  });
});
