import type { Theme, ThemeToken } from './tokens';

const HEX = /^#([0-9a-f]{6})$/i;

function relativeLuminance(hex: string): number | null {
  const match = HEX.exec(hex.trim());
  if (!match) return null;
  const channels = [0, 2, 4].map((offset) => parseInt(match[1]!.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x Kontrastverhältnis; wirft bei Nicht-Hex-Werten. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  if (a === null || b === null) throw new Error('contrastRatio expects #rrggbb values');
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

export interface ContrastPair {
  fg: ThemeToken;
  bg: ThemeToken;
  minimum: number;
}

/** Textpaare 4.5:1 (AA), Platzhalter und Fokusring 3:1. Alle Paare bestehen im Default-Theme. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'ink', bg: 'bg', minimum: 4.5 },
  { fg: 'ink', bg: 'surface', minimum: 4.5 },
  { fg: 'ink', bg: 'surface-2', minimum: 4.5 },
  { fg: 'ink', bg: 'code-bg', minimum: 4.5 },
  { fg: 'ink-2', bg: 'surface', minimum: 4.5 },
  { fg: 'ink-2', bg: 'bg', minimum: 4.5 },
  { fg: 'muted', bg: 'surface', minimum: 4.5 },
  { fg: 'muted', bg: 'bg', minimum: 4.5 },
  { fg: 'muted', bg: 'table-head-bg', minimum: 4.5 },
  { fg: 'on-primary', bg: 'color-primary', minimum: 4.5 },
  { fg: 'color-primary-ink', bg: 'color-primary-soft', minimum: 4.5 },
  { fg: 'color-accent-deep', bg: 'color-accent-soft', minimum: 4.5 },
  { fg: 'color-success', bg: 'color-success-bg', minimum: 4.5 },
  { fg: 'color-warning', bg: 'color-warning-bg', minimum: 4.5 },
  { fg: 'color-error', bg: 'color-error-bg', minimum: 4.5 },
  { fg: 'color-info', bg: 'color-info-bg', minimum: 4.5 },
  { fg: 'color-success', bg: 'surface', minimum: 4.5 },
  { fg: 'color-warning', bg: 'surface', minimum: 4.5 },
  { fg: 'color-error', bg: 'surface', minimum: 4.5 },
  { fg: 'color-info', bg: 'surface', minimum: 4.5 },
  { fg: 'selected-ink', bg: 'selected-bg', minimum: 4.5 },
  { fg: 'tooltip-ink', bg: 'tooltip-bg', minimum: 4.5 },
  { fg: 'neutral-badge-ink', bg: 'neutral-badge-bg', minimum: 4.5 },
  { fg: 'link', bg: 'surface', minimum: 4.5 },
  { fg: 'input-placeholder', bg: 'input-bg', minimum: 3 },
  { fg: 'focus-ring', bg: 'bg', minimum: 3 },
];

export interface ContrastFinding {
  fg: ThemeToken;
  bg: ThemeToken;
  mode: 'light' | 'dark';
  ratio: number;
  minimum: number;
}

export function checkThemeContrast(theme: Theme): ContrastFinding[] {
  const findings: ContrastFinding[] = [];
  for (const pair of CONTRAST_PAIRS) {
    for (const mode of ['light', 'dark'] as const) {
      const fg = theme.tokens[pair.fg][mode];
      const bg = theme.tokens[pair.bg][mode];
      if (relativeLuminance(fg) === null || relativeLuminance(bg) === null) continue;
      const ratio = contrastRatio(fg, bg);
      if (ratio < pair.minimum) findings.push({ fg: pair.fg, bg: pair.bg, mode, ratio: Math.round(ratio * 100) / 100, minimum: pair.minimum });
    }
  }
  return findings;
}
