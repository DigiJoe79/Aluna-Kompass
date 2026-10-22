import { describe, expect, it } from 'vitest';
import { CONTRAST_PAIRS, checkThemeContrast } from '../src/themes/contrast';
import { DEFAULT_THEME } from '../src/themes/default-theme';
import { THEME_TOKENS, themeTokensSchema } from '../src/themes/tokens';

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

  it('gives every token a light and a dark value in the default theme', () => {
    for (const token of THEME_TOKENS) {
      expect(DEFAULT_THEME.tokens[token].light, token).toBeTruthy();
      expect(DEFAULT_THEME.tokens[token].dark, token).toBeTruthy();
    }
    expect(themeTokensSchema.safeParse(DEFAULT_THEME.tokens).success).toBe(true);
  });

  it('checks the ink/surface pairs of the default theme for contrast', () => {
    const pairs = CONTRAST_PAIRS.map((p) => `${p.fg}/${p.bg}:${p.minimum}`);
    expect(pairs).toEqual(
      expect.arrayContaining([
        'color-final/color-final-bg:4.5',
        'color-agent/color-agent-bg:4.5',
        'color-amount-out/surface:4.5',
        'color-amount-out/table-zebra:4.5',
        'color-key-ink/color-key-bg:4.5',
        'color-drop-ink/color-drop-bg:4.5',
        'color-drop-ring/surface:3',
        'color-drop-blocked-ring/surface:3',
        'line-2/surface:1.6',
        'line-2/table-zebra:1.6',
        'color-tree-guide/surface:1.6',
        'disabled-ink/disabled-bg:3',
      ]),
    );
    expect(checkThemeContrast(DEFAULT_THEME)).toEqual([]);
  });

  // Designer 2026-10-16, Teil 3 Nr. 4: ein Trenner-Token für Tabellenzeilen und Ordnerbaum, im Dunkeln ≥ 1,6:1 zur Fläche.
  it('holds the separator threshold only in dark mode', () => {
    const faint = { ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, 'line-2': { light: '#FAFAFA', dark: '#22262C' } } };
    const findings = checkThemeContrast(faint).filter((f) => f.fg === 'line-2');
    // Hell gilt die Schwelle nicht: Dort ist die Fläche weiß, und ein Trenner bleibt bewusst leise.
    expect(findings.map((f) => `${f.bg}:${f.mode}`)).toEqual(['surface:dark', 'table-zebra:dark']);
  });
});
