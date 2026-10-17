import type { DashboardTileView } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import type { DateFormatter } from '@/lib/date-format';
import { cn } from '@/lib/utils';
import { TileLines } from './tile-lines';
import { SectionHeading } from '@/components/section';


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
export async function TileCard({ view, canComplete, fmt }: { view: DashboardTileView; canComplete: boolean; fmt: DateFormatter }) {
  const t = await getTranslations('dashboard');
  const ns = `tiles.${view.module}.${view.key}`;
  const empty = isEmpty(view);
  const content = view.content;
  // Die kleine Zahl im Kopf nur bei Listen-Kacheln; eine Zahl-Kachel zeigt sie groß im Inhalt, nicht doppelt (01 B5).
  const counter = content?.kind === 'list' ? content.total : null;
  const openLink = (href: string | null) =>
    href ? (
      <Link href={href} className={buttonVariants({ variant: 'secondary', className: 'w-fit' })}>
        {t(`${ns}.open`)}
      </Link>
    ) : null;

  let body: React.ReactNode;
  if (view.error || !content) {
    body = <p className="text-meta text-muted-ink">{t('tileError')}</p>;
  } else if (empty) {
    body = <p className="text-meta text-muted-ink">{t(`${ns}.empty`)}</p>;
  } else if (content.kind === 'count' || (content.kind === 'list' && content.lines.length === 0)) {
    const n = content.kind === 'count' ? content.count : content.total;
    body = (
      <>
        <p className="text-figure tabular-nums text-ink">{n}</p>
        {content.kind === 'count' && content.note ? <p className="text-meta text-ink-2">{t(`${ns}.messages.${content.note.messageKey}`, content.note.values ?? {})}</p> : null}
        {openLink(content.href)}
      </>
    );
  } else if (content.kind === 'list') {
    body = (
      <>
        <TileLines ns={ns} lines={content.lines} canComplete={canComplete} />
        {content.total > content.lines.length && content.href ? (
          <Link href={content.href} className="text-meta underline underline-offset-2 hover:text-link">{t('showAll', { count: content.total })}</Link>
        ) : (
          openLink(content.href)
        )}
      </>
    );
  } else {
    const values: Record<string, string | number> = { ...(content.values ?? {}) };
    if (typeof values.date === 'string') values.date = fmt.dateTime(values.date);
    body = (
      <>
        {/* Die Warnung trägt der Kachelkopf als Ton, nicht eine Box im Inhalt (Designer Stufe 2 Nr. 1, 02 B5). */}
        <p className="text-meta text-ink-2">{t(`${ns}.messages.${content.messageKey}`, values)}</p>
        {openLink(content.href)}
      </>
    );
  }

  const warning = !view.error && content?.kind === 'status' && content.tone === 'warning';

  return (
    // Leer heißt ok: gedämpft über die Fläche der Seite statt über Deckkraft — Titel und Satz bleiben auch dunkel
    // ≥ 4,5:1 (Paare ink/bg und muted/bg, 02 C11). Kein Layout-Test für diese Einzelstelle (AGENTS.md).
    <section
      data-testid={`dashboard-tile-${view.module}-${view.key}`}
      data-tone={warning ? 'warning' : empty ? 'ok' : undefined}
      className={cn('flex flex-col gap-3 rounded-lg border border-line p-[18px]', empty ? 'bg-bg' : 'bg-surface', view.kind === 'list' && 'md:col-span-2')}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2">
          {warning ? (
            <>
              <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
              <span className="sr-only">{t('toneWarning')}</span>
            </>
          ) : null}
          <SectionHeading>{t(`${ns}.title`)}</SectionHeading>
        </span>
        {counter !== null && !empty ? <span className="tabular-nums text-hint text-muted-ink">{counter}</span> : null}
      </div>
      {body}
    </section>
  );
}
