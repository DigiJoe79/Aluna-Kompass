import { THEME_TOKENS, type Theme } from '@kompass/core';

const SAFE_VALUE = /^[^{};<>]+$/;

function block(selector: string, theme: Theme, mode: 'light' | 'dark'): string {
  const declarations = THEME_TOKENS.map((token) => {
    const value = theme.tokens[token][mode];
    if (!SAFE_VALUE.test(value)) throw new Error(`invalid token value for ${token}`);
    return `--${token}:${value}`;
  });
  return `${selector}{${declarations.join(';')}}`;
}

export function themeToCss(theme: Theme): string {
  return `${block(':root', theme, 'light')}\n${block(':root[data-color-scheme="dark"]', theme, 'dark')}`;
}
