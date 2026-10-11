import type { AppEnv } from '@kompass/core';
import { ImageResponse } from 'next/og';
import { ICON_COLORS, ICON_NORTH } from '@/lib/env-icon';

/**
 * Die Nadel als PNG: Safari nimmt im Tab kein SVG-Icon (Joe 2026-10-11, Ersatzkachel statt Nadel), iOS braucht
 * fürs Apple-Icon ein PNG ohne Rundung. Geometrie und Farben wie `iconSvg`.
 */
export function iconPng(env: AppEnv, px: number, rounded: boolean): ImageResponse {
  const { ground, south } = ICON_COLORS[env];
  return new ImageResponse(
    (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width={px} height={px}>
        <rect width="32" height="32" rx={rounded ? 7 : 0} fill={ground} />
        <path fill={ICON_NORTH} d="M25 7 18.8 18.8 13.2 13.2Z" />
        <path fill={south} d="M7 25 13.2 13.2 18.8 18.8Z" />
      </svg>
    ),
    { width: px, height: px },
  );
}
