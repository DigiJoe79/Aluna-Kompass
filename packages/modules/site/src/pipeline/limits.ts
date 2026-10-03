import type { SiteEnv } from './env';
import type { StepKey } from './run-state';
import type { StepLimit } from './step';

const s = (n: number) => n * 1_000;

/**
 * Alle Zeitlimits an einer Stelle. `totalMs` begrenzt den Schritt, `stallMs`
 * den Stillstand des Zählers. Die Bildvarianten bekommen einen Grundwert und
 * je fehlender Variante `perItemMs` dazu (`imageLimit`): Der erste Bau nach
 * vielen neuen Bildern ist legitim lang.
 */
export const SITE_LIMITS: Record<StepKey, StepLimit> = {
  export: { totalMs: s(600), stallMs: s(60) },
  images: { totalMs: s(120), stallMs: s(120), perItemMs: 2_000 },
  build: { totalMs: s(900), stallMs: s(300) },
  copyImages: { totalMs: s(600), stallMs: s(60) },
  checksums: { totalMs: s(600), stallMs: s(60) },
  connect: { totalMs: s(30), stallMs: s(30) },
  targetDir: { totalMs: s(30), stallMs: s(30) },
  writable: { totalMs: s(60), stallMs: s(60) },
  targetFiles: { totalMs: s(180), stallMs: s(60) },
  transfer: { totalMs: s(1_800), stallMs: s(300) },
  record: { totalMs: s(60), stallMs: s(60) },
};

export function limitFor(env: SiteEnv, key: StepKey): StepLimit {
  return { ...SITE_LIMITS[key], ...env.limits?.[key] };
}

export function imageLimit(env: SiteEnv, missing: number): StepLimit {
  const base = limitFor(env, 'images');
  return { ...base, totalMs: base.totalMs + (base.perItemMs ?? 0) * missing };
}
