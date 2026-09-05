import { z } from 'zod';

export const THEME_TOKENS = [
  // Marke
  'color-primary', 'color-primary-ink', 'color-primary-soft',
  'color-accent', 'color-accent-deep', 'color-accent-soft',
  // Status
  'color-success', 'color-success-bg', 'color-warning', 'color-warning-bg',
  'color-error', 'color-error-bg', 'color-info', 'color-info-bg',
  // Flächen
  'bg', 'surface', 'surface-2', 'sidebar-bg', 'topbar-bg',
  // Schrift und Linien
  'ink', 'ink-2', 'muted', 'muted-2', 'on-primary', 'on-primary-muted', 'line', 'line-2', 'line-strong',
  // Interaktion
  'focus-ring', 'hover-surface', 'active-surface', 'selected-bg', 'selected-ink',
  'link', 'link-hover', 'disabled-ink', 'disabled-bg',
  // Tabellen und Felder
  'table-head-bg', 'table-zebra', 'table-row-hover', 'input-bg', 'input-placeholder', 'code-bg',
  'neutral-badge-bg', 'neutral-badge-ink', 'tooltip-bg', 'tooltip-ink',
  // Tiefe
  'overlay', 'shadow-sm', 'shadow-md',
  // Typografie und Form
  'font-body', 'font-heading', 'font-mono', 'radius-sm', 'radius-md', 'radius-lg', 'radius-full', 'row-h',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

const tokenValue = z.string().trim().min(1).max(160);
const pair = z.object({ light: tokenValue, dark: tokenValue }).strict();

export const themeTokensSchema = z
  .object(Object.fromEntries(THEME_TOKENS.map((token) => [token, pair])) as Record<ThemeToken, typeof pair>)
  .strict();

export const THEME_KEY_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

export const themeSchema = z
  .object({
    key: z.string().regex(THEME_KEY_PATTERN),
    name: z.string().trim().min(1).max(60),
    tokens: themeTokensSchema,
  })
  .strict();

export type ThemeTokens = z.infer<typeof themeTokensSchema>;
export type Theme = z.infer<typeof themeSchema>;
