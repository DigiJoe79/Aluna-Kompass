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

  it('escapes nothing dangerous: values with braces or semicolons are rejected', () => {
    const theme = { ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, bg: { light: '#fff}body{color:red', dark: '#000' } } };
    expect(() => themeToCss(theme)).toThrow(/invalid token value/);
  });
});
