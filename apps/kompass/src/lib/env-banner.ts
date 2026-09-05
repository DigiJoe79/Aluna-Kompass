import type { AppEnv } from '@kompass/core';

export interface BannerContext {
  lastImportAt: string | null;
  migrationCount: number;
}

export type Banner = { kind: 'test'; label: 'TESTUMGEBUNG' } | { kind: 'development'; label: 'ENTWICKLUNG' };

export function bannerFor(env: AppEnv, _ctx: BannerContext): Banner | null {
  if (env === 'production') return null;
  return env === 'test' ? { kind: 'test', label: 'TESTUMGEBUNG' } : { kind: 'development', label: 'ENTWICKLUNG' };
}

export function environmentConfirmationName(env: AppEnv): string {
  return env === 'production' ? 'produktion' : env === 'test' ? 'test' : 'entwicklung';
}
