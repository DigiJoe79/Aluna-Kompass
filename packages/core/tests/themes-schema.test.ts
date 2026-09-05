import { describe, expect, it } from 'vitest';
import { checkThemeContrast, CONTRAST_PAIRS, contrastRatio } from '../src/themes/contrast';
import { DEFAULT_THEME } from '../src/themes/default-theme';
import { THEME_TOKENS, themeSchema } from '../src/themes/tokens';
import { readSetting } from '../src/settings/service';
import { createTestDeps } from '../src/testing';

describe('theme schema', () => {
  it('defines 58 tokens including the design-round additions', () => {
    expect(THEME_TOKENS).toHaveLength(58);
    for (const token of ['color-primary', 'focus-ring', 'table-zebra', 'input-bg', 'overlay', 'shadow-md', 'font-mono', 'radius-full', 'row-h']) {
      expect(THEME_TOKENS).toContain(token);
    }
  });

  it('accepts the default theme and rejects incomplete or extended themes', () => {
    expect(themeSchema.safeParse(DEFAULT_THEME).success).toBe(true);
    const { 'row-h': _dropped, ...rest } = DEFAULT_THEME.tokens;
    expect(themeSchema.safeParse({ ...DEFAULT_THEME, tokens: rest }).success).toBe(false);
    expect(themeSchema.safeParse({ ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, extra: { light: '#000', dark: '#fff' } } }).success).toBe(false);
    expect(themeSchema.safeParse({ ...DEFAULT_THEME, key: 'Bad Key' }).success).toBe(false);
  });

  it('is registered as the `themes` setting default', () => {
    const deps = createTestDeps();
    const themes = readSetting<{ key: string }[]>(deps, 'themes');
    expect(themes.map((t) => t.key)).toEqual(['default']);
  });
});

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#191C1F', '#F6F6F4')).toBeGreaterThan(15);
    expect(contrastRatio('#8B9199', '#FFFFFF')).toBeCloseTo(3.18, 1);
  });

  it('the default theme passes every checked pair in light and dark', () => {
    expect(CONTRAST_PAIRS.length).toBeGreaterThanOrEqual(20);
    expect(checkThemeContrast(DEFAULT_THEME)).toEqual([]);
  });

  it('reports failing pairs with ratio and mode', () => {
    const broken = { ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, muted: { light: '#DDDDDD', dark: '#9AA1A9' } } };
    const findings = checkThemeContrast(broken);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]).toMatchObject({ fg: 'muted', mode: 'light', minimum: 4.5 });
    expect(findings[0]!.ratio).toBeLessThan(4.5);
    expect(findings.every((f) => f.mode === 'light')).toBe(true);
  });

  it('skips non-hex values such as shadows and rgba overlays without throwing', () => {
    const theme = { ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, surface: { light: 'rgba(255,255,255,1)', dark: '#1B1E23' } } };
    expect(() => checkThemeContrast(theme)).not.toThrow();
  });
});
