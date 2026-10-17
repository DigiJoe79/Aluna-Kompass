import { THEME_TOKENS, type ThemeToken } from '@kompass/core/themes';

/**
 * Gruppen des Theme-Editors (Runde 3, 179): rund neunzig Tokens in einer Liste waren nicht bedienbar. Die Reihenfolge
 * folgt `THEME_TOKENS` im Kern; `tests/theme-editor.test.tsx` hält die Gruppen vollständig.
 */
export const THEME_TOKEN_GROUPS: readonly { key: string; tokens: readonly ThemeToken[] }[] = [
  { key: 'brand', tokens: ['color-primary', 'color-primary-ink', 'color-primary-soft', 'color-accent', 'color-accent-deep', 'color-accent-soft'] },
  {
    key: 'status',
    tokens: ['color-success', 'color-success-bg', 'color-warning', 'color-warning-bg', 'color-error', 'color-error-bg', 'color-info', 'color-info-bg', 'color-final', 'color-final-bg', 'color-agent', 'color-agent-bg', 'neutral-badge-bg', 'neutral-badge-ink'],
  },
  { key: 'surfaces', tokens: ['bg', 'surface', 'surface-2', 'sidebar-bg', 'topbar-bg', 'overlay', 'shadow-sm', 'shadow-md'] },
  { key: 'text', tokens: ['ink', 'ink-2', 'muted', 'muted-2', 'on-primary', 'on-primary-muted', 'link', 'link-hover'] },
  { key: 'lines', tokens: ['line', 'line-2', 'line-strong', 'focus-ring'] },
  {
    key: 'states',
    tokens: ['hover-surface', 'active-surface', 'selected-bg', 'selected-ink', 'disabled-ink', 'disabled-bg', 'tooltip-bg', 'tooltip-ink'],
  },
  { key: 'fields', tokens: ['table-head-bg', 'table-zebra', 'table-row-hover', 'input-bg', 'input-placeholder', 'code-bg', 'color-key-bg', 'color-key-ink', 'color-amount-out'] },
  {
    key: 'tree',
    tokens: ['color-drop-bg', 'color-drop-ring', 'color-drop-ink', 'color-drop-blocked-ring', 'color-drop-blocked-hatch', 'color-tree-guide'],
  },
  // Schriften, Radien und Zeilenhöhe aus der Liste des Kerns gelesen (die Namen stünden sonst als Klassen im Quelltext).
  { key: 'shapes', tokens: THEME_TOKENS.filter((token) => /^(?:font|radius)-|^row-h$/.test(token)) },
];
