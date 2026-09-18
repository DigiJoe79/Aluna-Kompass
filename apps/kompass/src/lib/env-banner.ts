import type { AppEnv } from '@kompass/core';

export interface BannerContext {
  lastImportAt: string | null;
  migrationCount: number;
}

/**
 * Nur die Art, keine Beschriftung: Der sichtbare Text steht in
 * `messages/de.json` unter `shell.envBanner`. Er stand bis zum 2026-09-15
 * hier als Literal — in einer `.ts`, wo ihn weder der Wächter für
 * Komponenten noch der für Server-Actions je gesucht hätte.
 */
export type Banner = { kind: 'test' | 'development' };

export function bannerFor(env: AppEnv, _ctx: BannerContext): Banner | null {
  if (env === 'production') return null;
  return { kind: env === 'test' ? 'test' : 'development' };
}

export function environmentConfirmationName(env: AppEnv): string {
  return env === 'production' ? 'produktion' : env === 'test' ? 'test' : 'entwicklung';
}
