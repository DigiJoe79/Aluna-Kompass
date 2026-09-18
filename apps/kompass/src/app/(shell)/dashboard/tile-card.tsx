import type { DashboardTileView } from '@kompass/core';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TileLines } from './tile-lines';

const TONE: Record<'neutral' | 'info' | 'warning', string> = {
  neutral: 'text-ink-2',
  info: 'rounded-md border border-info bg-info-bg p-3 text-ink-2',
  warning: 'rounded-md border border-warning bg-warning-bg p-3 text-ink',
};

function isEmpty(view: DashboardTileView): boolean {
  if (view.error || !view.content) return false;
  if (view.content.kind === 'count') return view.content.count === 0;
  if (view.content.kind === 'list') return view.content.total === 0;
  return false;
}

/**
 * Eine Kachel nach Form (Spec 2026-09-17, § 6). `list` ist doppelt breit, das
 * entscheidet die Form. Leer heißt: ein Satz, gedämpft, der Platz bleibt.
 */
export async function TileCard({ view, canComplete }: { view: DashboardTileView; canComplete: boolean }) {
  const t = await getTranslations('dashboard');
  const format = await getFormatter();
  const ns = `tiles.${view.module}.${view.key}`;
  const empty = isEmpty(view);
  const content = view.content;
  const counter = content?.kind === 'count' ? content.count : content?.kind === 'list' ? content.total : null;
  const openLink = (href: string | null) =>
    href ? (
      <Link href={href} className={buttonVariants({ variant: 'secondary', className: 'w-fit' })}>
        {t(`${ns}.open`)}
      </Link>
    ) : null;

  let body: React.ReactNode;
  if (view.error || !content) {
    body = <p className="text-[13px] text-muted-ink">{t('tileError')}</p>;
  } else if (empty) {
    body = <p className="text-[13px] text-muted-ink">{t(`${ns}.empty`)}</p>;
  } else if (content.kind === 'count' || (content.kind === 'list' && content.lines.length === 0)) {
    const n = content.kind === 'count' ? content.count : content.total;
    body = (
      <>
        <p className="font-mono text-[32px] leading-none text-ink">{n}</p>
        {openLink(content.href)}
      </>
    );
  } else if (content.kind === 'list') {
    body = (
      <>
        <TileLines ns={ns} lines={content.lines} canComplete={canComplete} />
        {content.total > content.lines.length && content.href ? (
          <Link href={content.href} className="text-[13px] underline underline-offset-2 hover:text-link">{t('showAll', { count: content.total })}</Link>
        ) : (
          openLink(content.href)
        )}
      </>
    );
  } else {
    const values: Record<string, string | number> = { ...(content.values ?? {}) };
    if (typeof values.date === 'string') values.date = format.dateTime(new Date(values.date), { dateStyle: 'medium', timeStyle: 'short' });
    body = (
      <>
        <p className={cn('text-[13px] leading-[1.55]', TONE[content.tone])}>{t(`${ns}.messages.${content.messageKey}`, values)}</p>
        {openLink(content.href)}
      </>
    );
  }

  return (
    <section
      data-testid={`dashboard-tile-${view.module}-${view.key}`}
      className={cn('flex flex-col gap-3 rounded-lg border border-line bg-surface p-[18px]', view.kind === 'list' && 'md:col-span-2', empty && 'opacity-70')}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-[17px]">{t(`${ns}.title`)}</h3>
        {counter !== null && !empty ? <span className="font-mono text-[12px] text-muted-ink">{counter}</span> : null}
      </div>
      {body}
    </section>
  );
}
