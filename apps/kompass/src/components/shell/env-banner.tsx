import { useTranslations } from 'next-intl';
import type { Banner, BannerContext } from '@/lib/env-banner';

// theme-exception: environment banner — die einzigen Farbwerte, die kein Theme überschreiben darf.
const COLORS = {
  test: { bg: '#1A1A1A', fg: '#F2C200', stripe: 120 },
  development: { bg: '#B3261E', fg: '#FFFFFF', stripe: 80 },
} as const;

export function EnvBanner({ banner, context }: { banner: Banner; context: BannerContext }) {
  const t = useTranslations('shell.envBanner');
  const c = COLORS[banner.kind];
  const stripe = (angle: number) => `repeating-linear-gradient(${angle}deg, ${c.fg} 0 8px, ${c.bg} 8px 16px)`;
  const detail =
    banner.kind === 'test'
      ? t('testContext', { date: context.lastImportAt ? new Date(context.lastImportAt).toLocaleDateString('de-DE') : t('noImport') })
      : t('devContext', { migrations: context.migrationCount });
  return (
    <div role="status" data-testid="env-banner" style={{ background: c.bg, color: c.fg, height: 28 }} className="relative flex items-center justify-center gap-3 overflow-hidden text-[12px] font-bold tracking-[.18em]">
      <div aria-hidden style={{ background: stripe(135), width: c.stripe, opacity: 0.9 }} className="absolute inset-y-0 left-0" />
      <div aria-hidden style={{ background: stripe(45), width: c.stripe, opacity: 0.9 }} className="absolute inset-y-0 right-0" />
      <span className="relative z-[1]">{banner.label}</span>
      <span className="relative z-[1] text-[11px] font-normal tracking-normal">{detail}</span>
    </div>
  );
}
