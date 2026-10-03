'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { stepCounter } from '@/lib/site-job-steps';
import { useSiteJobStatus } from './site-job-provider';

/** Der laufende Lauf in der Kopfzeile: Art, Schritt und Zähler; ein Klick führt zum Veröffentlichen. */
export function SiteJobIndicator() {
  const t = useTranslations('site.publish.job');
  const { running } = useSiteJobStatus();
  if (!running) return null;
  const step = running.steps.find((s) => s.state === 'running') ?? running.steps.find((s) => s.state === 'pending') ?? running.steps.at(-1);
  const counter = step ? stepCounter(step) : null;
  const progress = counter ? t(`count.${counter.key}`, counter.values) : '';
  const kind = t(`names.${running.kind}`);
  return (
    <Link href="/site/publish" data-testid="site-job" aria-live="polite" className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-line-strong bg-field px-2.5 text-[13px] font-medium text-ink-2 hover:bg-hover">
      <span className="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
      <span className="sm:hidden">{t('indicatorShort', { kind, progress }).trim()}</span>
      <span className="hidden sm:inline">{t('indicator', { kind, step: step ? t(`steps.${step.key}`) : '', progress }).trim()}</span>
    </Link>
  );
}
