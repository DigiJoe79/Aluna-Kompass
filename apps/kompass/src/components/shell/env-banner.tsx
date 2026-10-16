import { useTranslations } from 'next-intl';
import type { Banner, BannerContext } from '@/lib/env-banner';

// theme-exception: environment banner — die einzigen Farbwerte, die kein Theme überschreiben darf.
/**
 * Farben je Umgebung (Designer 2026-10-16, Teil 3 Nr. 15): Test ist die Kopie mit Echtdaten — Ocker mit Schraffur heißt
 * „echte Daten, Vorsicht“; Entwicklung neutrales Dunkelgrau ohne Schraffur; Produktion hat keinen Balken. Rot steht auf
 * keinem Balken, Violett gehört `agent`. Schrift ≥ 4,5:1 zur Fläche (`tests/env-banner.test.ts`).
 */
export const BANNER_COLORS = {
  test: { bg: '#D9A21B', fg: '#1A1A1A', hatch: '#B8860B', stripe: 120 },
  development: { bg: '#3B3E44', fg: '#FFFFFF', hatch: null, stripe: 0 },
} as const;

/** `date` formatiert wie die Schale (`dateFormatOf`): `lastImportAt` ist ein Zeitstempel und zeigt den Tag des Vereins. */
export function EnvBanner({ banner, context, date }: { banner: Banner; context: BannerContext; date: (value: string) => string }) {
  const t = useTranslations('shell.envBanner');
  const c = BANNER_COLORS[banner.kind];
  const label = t(banner.kind);
  const stripe = (angle: number) => `repeating-linear-gradient(${angle}deg, ${c.hatch} 0 8px, ${c.bg} 8px 16px)`;
  const detail =
    banner.kind === 'test'
      ? (context.lastImportAt ? t('testContext', { date: date(context.lastImportAt) }) : t('testContextNoImport'))
      : t('devContext', { migrations: context.migrationCount });
  return (
    <div data-testid="env-banner" aria-label={label} style={{ background: c.bg, color: c.fg, height: 28 }} className="relative flex items-center justify-center gap-3 overflow-hidden text-hint font-semibold">
      {c.hatch ? (
        <>
          <div aria-hidden style={{ background: stripe(135), width: c.stripe, opacity: 0.9 }} className="absolute inset-y-0 left-0" />
          <div aria-hidden style={{ background: stripe(45), width: c.stripe, opacity: 0.9 }} className="absolute inset-y-0 right-0" />
        </>
      ) : null}
      <span className="relative z-[1]">{label}</span>
      <span className="relative z-[1] text-hint font-normal">{detail}</span>
    </div>
  );
}
