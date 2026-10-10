'use client';

import { Globe } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { stepCounter } from '@/lib/site-job-steps';
import type { PendingView } from '@/lib/site-job-view';
import { useSiteJobStatus } from './site-job-provider';

/**
 * Der laufende Lauf in der Kopfzeile: Art, Schritt und Zähler; ein Klick führt zum Veröffentlichen. In Ruhe steht an
 * derselben Stelle, wie viel noch nicht publiziert ist (Board Vorschläge 8a, Designer 2026-10-10).
 */
export function SiteJobIndicator() {
  const t = useTranslations('site.publish.job');
  const { running, pending } = useSiteJobStatus();
  if (!running) return pending && pending.count > 0 ? <PendingIndicator pending={pending} /> : null;
  const step = running.steps.find((s) => s.state === 'running') ?? running.steps.find((s) => s.state === 'pending') ?? running.steps.at(-1);
  const counter = step ? stepCounter(step) : null;
  const progress = counter ? t(`count.${counter.key}`, counter.values) : '';
  const kind = t(`names.${running.kind}`);
  return (
    <Link href="/site/publish" data-testid="site-job" aria-live="polite" className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-line-strong bg-field px-2.5 text-[13px] font-medium text-ink-2 hover:bg-hover">
      <span className="size-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden />
      <span className="sm:hidden">{t('indicatorShort', { kind, progress }).trim()}</span>
      <span className="hidden sm:inline">{t('indicator', { kind, step: step ? t(`steps.${step.key}`) : '', progress }).trim()}</span>
    </Link>
  );
}

/** Board 8a: gelb, weil die Webseite etwas anderes zeigt als Kompass; am Rechner Wort und Zahl mit Menü, am Telefon Symbol mit Zahl. */
function PendingIndicator({ pending }: { pending: PendingView }) {
  const tp = useTranslations('site.pending');
  return (
    <>
      <Link
        href="/site/publish"
        data-testid="site-pending"
        aria-label={tp('indicatorLabel', { count: pending.count })}
        className="relative flex size-11 shrink-0 items-center justify-center text-warning sm:hidden"
      >
        <Globe className="size-5" aria-hidden />
        <span aria-hidden className="absolute top-1.5 right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning px-1 text-[11px] font-bold text-surface">
          {pending.count}
        </span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              data-testid="site-pending-menu"
              className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border border-warning bg-warning-bg px-3 text-[13px] font-semibold text-warning max-sm:hidden"
            />
          }
        >
          <Globe className="size-3.5" aria-hidden />
          {tp('indicator', { count: pending.count })}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-surface shadow-md">
          {pending.items.map((item) => (
            // Von der Webseite genommen: kein eigener Link, den Datensatz gibt es vielleicht nicht mehr.
            <DropdownMenuItem key={item.key} render={<Link href={item.href ?? '/site/publish'} />}>
              {item.label}
              {item.kind === 'changed' ? null : (
                <>
                  {' '}
                  <span className="text-muted-ink">({tp(`kind.${item.kind}`)})</span>
                </>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href="/site/publish" />}>{tp('toPublish')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
