import type { DashboardTileView } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { SectionHeading } from '@/components/section';
import type { DateFormatter } from '@/lib/date-format';
import { cn } from '@/lib/utils';
import { tileArt } from './columns';
import { TileLines } from './tile-lines';

/** Höchstens so viele Zeilen zeigt eine Liste, wenn sie ein Ziel für den Rest hat (Briefing § 3). */
const LIST_ROWS = 5;

/** Karte eines Widgets mit Arbeit: Fläche, Rand, Polster 16/18 (Briefing § 4). */
const CARD = 'rounded-lg border border-line bg-surface px-[18px] py-4';

/**
 * Ein Widget der Startseite nach seiner Art (Briefing Startseite § 4, Vorgaben Teil M). Es gibt keinen „Zu …“-Knopf
 * mehr: Eine Zahl ist als Ganzes der Link, eine Liste führt über Titel und Zeilen, ein Knopf steht nur an einer Warnung
 * und nennt dann ein Verb (`…action`). Ohne Arbeit schrumpft jedes Widget auf eine gedämpfte Zeile und bleibt an seinem
 * Platz. Die Kennung `dashboard-tile-…` steht am äußeren Element, ein Link liegt innen.
 */
export async function TileCard({ view, canComplete, fmt }: { view: DashboardTileView; canComplete: boolean; fmt: DateFormatter }) {
  const t = await getTranslations('dashboard');
  const ns = `tiles.${view.module}.${view.key}`;
  const art = tileArt(view);
  const content = view.content;
  const testId = `dashboard-tile-${view.module}-${view.key}`;
  const heading = t(`${ns}.title`);
  const statusSentence = () => {
    if (content?.kind !== 'status') return '';
    const values: Record<string, string | number> = { ...(content.values ?? {}) };
    if (typeof values.date === 'string') values.date = fmt.dateTime(values.date);
    return t(`${ns}.messages.${content.messageKey}`, values);
  };

  if (art === 'calm' || art === 'error' || !content) {
    // Ruhe: eine Zeile, gedämpft, Rand `line-2`, keine Fläche, nicht klickbar (Briefing § 4). Die Überschrift bleibt für
    // Vorleser eine Überschrift; Titel und Satz halten in `muted` ≥ 4,5:1 zur Seite (02 C11).
    const sentence = art === 'error' || !content ? t('tileError') : content.kind === 'status' ? statusSentence() : t(`${ns}.empty`);
    return (
      <section data-testid={testId} data-tone={art === 'calm' ? 'ok' : undefined} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded-lg border border-line-2 px-4 py-2.5">
        <SectionHeading>
          <span className="font-body text-body font-semibold text-muted-ink">{heading}</span>
        </SectionHeading>
        <p className="text-meta text-muted-ink">{sentence}</p>
      </section>
    );
  }

  if (content.kind === 'status' && art === 'warning') {
    return (
      <section data-testid={testId} data-tone="warning" className={cn(CARD, 'flex flex-col gap-2')}>
        <span className="flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
          <span className="sr-only">{t('toneWarning')}</span>
          <SectionHeading>{heading}</SectionHeading>
        </span>
        <p className="text-pretty text-body text-ink-2">{statusSentence()}</p>
        {view.warningAction && content.href ? (
          <Link href={content.href} className={buttonVariants({ variant: 'outline', className: 'mt-1 w-fit' })}>
            {t(`${ns}.action`)}
          </Link>
        ) : null}
      </section>
    );
  }

  if (art === 'count' || art === 'info') {
    // Zahl (oder wartende Arbeit als Satz): das ganze Widget ist der Link, Zahl unten bündig (Briefing § 4). Mindesthöhe
    // 124 px; im Raster sind die Widgets einer Zeile gleich hoch. Lange Titel trennen (`hyphens`, `lang="de"` am `html`).
    const href = content.href;
    const figure =
      content.kind === 'status' ? (
        <p className="text-pretty text-body text-ink">{statusSentence()}</p>
      ) : (
        <p className="text-figure tabular-nums text-ink">{content.kind === 'count' ? content.count : content.total}</p>
      );
    // Höchstens eine Kontextzeile (Befund 2, Designer 2026-10-17): Was nicht passt, steht im `title`.
    const noteText = content.kind === 'count' && content.note ? t(`${ns}.messages.${content.note.messageKey}`, content.note.values ?? {}) : null;
    const note = noteText ? <p className="line-clamp-1 text-meta text-muted-ink" title={noteText}>{noteText}</p> : null;
    const inner = (
      <>
        <span className="flex items-start gap-1.5 hyphens-auto wrap-break-word">
          <span className="min-w-0 flex-1">
            <SectionHeading>{heading}</SectionHeading>
          </span>
          {href ? <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-ink" aria-hidden /> : null}
        </span>
        <span className="mt-auto flex flex-col gap-1">
          {figure}
          {note}
        </span>
      </>
    );
    const box = cn(CARD, 'flex h-full min-h-[124px] flex-col gap-2.5');
    return (
      <section data-testid={testId} className="h-full">
        {href ? (
          <Link href={href} className={cn(box, 'text-ink hover:border-line-strong hover:bg-hover')}>
            {inner}
          </Link>
        ) : (
          <div className={box}>{inner}</div>
        )}
      </section>
    );
  }

  if (content.kind !== 'list') return null;
  // Liste, Fällig, Arbeit: Titel und Zähler, darunter die Zeilen. Eine Liste mit Ziel zeigt höchstens fünf Zeilen und
  // „Alle n anzeigen“; ohne Ziel (Fällig) alle — Arbeit wird nie abgeschnitten. „Finanzen: zu tun“ zeigt alle.
  const cap = art === 'list' && content.href !== null;
  const lines = cap ? content.lines.slice(0, LIST_ROWS) : content.lines;
  const more = cap && content.total > lines.length;
  const titleLink = art === 'list' && content.href;
  const lastSpace = heading.lastIndexOf(' ');
  const headingStart = heading.slice(0, lastSpace + 1);
  const headingEnd = heading.slice(lastSpace + 1);
  return (
    <section data-testid={testId} className={cn(CARD, 'flex flex-col gap-1.5 pb-3.5')}>
      <div className="flex items-baseline gap-2">
        <SectionHeading>
          {titleLink ? (
            // Das › hängt am letzten Wort (Befund 1, 218): Bricht der Titel um, steht es am Ende der letzten Zeile, nicht
            // mittig neben dem ganzen Titelblock wie bei `inline-flex`.
            <Link href={content.href!} className="hover:text-link">
              {headingStart}
              <span className="whitespace-nowrap">
                {headingEnd}
                <ChevronRight className="ml-1 inline size-4 align-middle text-muted-ink" aria-hidden />
              </span>
            </Link>
          ) : (
            heading
          )}
        </SectionHeading>
        <span className="ml-auto tabular-nums text-hint text-muted-ink">{content.total}</span>
      </div>
      <TileLines ns={ns} lines={lines} canComplete={canComplete} variant={art === 'due' ? 'due' : art === 'work' ? 'work' : 'list'} />
      {more ? (
        <Link href={content.href!} className="mt-1.5 w-fit text-meta text-link underline underline-offset-2 hover:text-link-hover">
          {t('showAll', { count: content.total })}
        </Link>
      ) : null}
    </section>
  );
}
