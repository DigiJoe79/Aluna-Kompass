import { DEFAULT_THEME, THEME_TOKENS } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { themeToCss } from '@/lib/theme-css';

describe('themeToCss', () => {
  it('emits every token for light on :root and for dark on the data attribute', () => {
    const css = themeToCss(DEFAULT_THEME);
    expect(css.startsWith(':root{')).toBe(true);
    expect(css).toContain(':root[data-color-scheme="dark"]{');
    for (const token of THEME_TOKENS) {
      expect(css).toContain(`--${token}:`);
    }
    expect(css).toContain('--color-primary:#2F5D68');
    expect(css).toContain('--color-primary:#74B4C0');
  });

  /**
   * Seit dem 2026-09-15 weist `themeTokensSchema` solche Werte schon beim
   * Schreiben ab. Hier bleibt der zweite Riegel, weil es einen Weg gibt, der
   * an der Validierung vorbeiführt: Ein Backup-Import ersetzt die Datenbank
   * als Datei, ohne ihren Inhalt zu prüfen.
   *
   * Werfen wäre dabei die falsche Antwort. Das `<style>` liegt im
   * Wurzel-Layout, also auf jeder Seite — ein Wurf nähme die ganze Oberfläche
   * mit, einschließlich der Themes-Seite, über die man den Wert zurücknehmen
   * würde. Die Installation wäre nur noch über die Datenbank zu retten.
   */
  it('falls back to the default value instead of taking the whole interface down', () => {
    const theme = { ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, bg: { light: '#fff}body{color:red', dark: '#000' } } };
    const css = themeToCss(theme);
    expect(css).not.toContain('body{color:red');
    expect(css).toContain(`--bg:${DEFAULT_THEME.tokens.bg.light}`);
    // Der Rest des Themes bleibt unberührt — nur der eine Wert fällt zurück.
    expect(css).toContain(`--color-primary:${DEFAULT_THEME.tokens['color-primary'].light}`);
  });
});
