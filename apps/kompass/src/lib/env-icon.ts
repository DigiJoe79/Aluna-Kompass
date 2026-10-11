import type { AppEnv } from '@kompass/core';

/**
 * Browser-Icon „Nadel“ (Designer 2026-10-11, Handoff Icon): fester Grund, damit es auf hellen und dunklen
 * Tab-Leisten gleich trägt, und kein Vereins-Theme. Die Grundfarbe wechselt je Umgebung; Prod und Test laufen
 * auf demselben NAS, und Safari blendet den Port aus.
 */
/** Nordhälfte der Nadel, in jeder Umgebung gleich. */
export const ICON_NORTH = '#FFFFFF';

export const ICON_COLORS: Record<AppEnv, { ground: string; south: string }> = {
  production: { ground: '#2F5D68', south: '#D98B6A' },
  test: { ground: '#8A5A05', south: '#191C1F' },
  development: { ground: '#5B4A86', south: '#D98B6A' },
};

export function iconSvg(env: AppEnv): string {
  const { ground, south } = ICON_COLORS[env];
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
    `<rect width="32" height="32" rx="7" fill="${ground}"/>`,
    `<path fill="${ICON_NORTH}" d="M25 7 18.8 18.8 13.2 13.2Z"/>`,
    `<path fill="${south}" d="M7 25 13.2 13.2 18.8 18.8Z"/>`,
    '</svg>',
  ].join('');
}
