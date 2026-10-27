'use client';

import type { DashboardLine } from '@kompass/core';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toastRefusal } from '@/lib/feedback';
import { useDateFormat } from '@/components/date-format-provider';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { completeDueAction } from '../due-actions';
import { withVatPeriodLabel } from '@/lib/finance/vat-period';

/**
 * Die Zeilen einer Listen-Kachel nach ihrer Art (Briefing Startseite § 4, „Zeilen in Listen“):
 *
 * - `list` und `work`: Jede Zeile mit Ziel ist ein Link über die ganze Zeile, mit › am Ende; Polster 9 px, Trenner
 *   `line-2`, Hover `hover`. Der Betrag (`trailing`) steht rechts, Ziffern gleich breit. `work` bricht nach
 *   `column-width: 300px` in Spalten um, erst nach unten — in der breiten Spalte von 2:1 zweispaltig, sonst einspaltig.
 *   Die Regel „ab sieben Zeilen, ab `xl`“ aus Lauf 3 entfällt.
 * - `due`: Kästchen, Datum (überfällig im Ton `warning`), Text, darunter der Bezug als Link. Die Zeile selbst ist
 *   kein Link — das Kästchen ist die einzige Aktion auf der Startseite.
 *
 * Text, Bezug und Zusatz brechen um, statt zu kürzen: Arbeit wird nie abgeschnitten (Designer 005). Ein Wert `…On`
 * ist ein Tag und wird im Satz nach der Einstellung formatiert („seit 17.10.2026“), ein `vatPeriod` ein Zeitraum der
 * Umsatzsteuer („2. Quartal 2026“).
 */
export function TileLines({ ns, lines, canComplete, variant }: { ns: string; lines: DashboardLine[]; canComplete: boolean; variant: 'list' | 'due' | 'work' }) {
  const t = useTranslations('dashboard');
  const fmt = useDateFormat();
  const router = useRouter();
  const [, start] = useTransition();

  const root = useTranslations();
  // Ein Umsatzsteuer-Zeitraum (`vatPeriod`, E6a) wird lesbar wie in der Fristenliste.
  const valuesOf = (line: DashboardLine) =>
    withVatPeriodLabel(Object.fromEntries(Object.entries(line.values ?? {}).map(([key, value]) => [key, key.endsWith('On') && typeof value === 'string' ? fmt.date(value) : value])), root);
  const titleOf = (line: DashboardLine) => line.title ?? (line.titleKey ? t(`${ns}.messages.${line.titleKey}`, valuesOf(line)) : '');

  if (variant === 'due') {
    return (
      <ul>
        {lines.map((line, index) => {
          const title = titleOf(line);
          return (
            <li key={`${index}-${title}`} className="flex items-start gap-2.5 border-b border-line-2 py-2.5 last:border-b-0">
              {line.action && canComplete ? (
                <Checkbox
                  className="mt-0.5 shrink-0"
                  aria-label={t('complete', { title })}
                  onCheckedChange={() =>
                    start(async () => {
                      // R5 (MUSTER: Ausnahme): Das Häkchen sitzt in der Zeile einer Kachel, ohne Platz für eine Meldung — Toast bis zum Schließen.
                      const s = await completeDueAction(line.action!.followUpId);
                      if (s.status === 'error') toastRefusal(s);
                      else router.refresh();
                    })
                  }
                />
              ) : null}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  {line.date ? (
                    <span data-testid="tile-line-date" className={cn('tabular-nums text-hint', line.overdue ? 'font-semibold text-warning' : 'text-muted-ink')}>
                      {fmt.date(line.date)}
                    </span>
                  ) : null}
                  <span data-testid="tile-line-title" className="wrap-anywhere text-body text-ink">{title}</span>
                </span>
                {line.link ? (
                  line.link.href ? (
                    <Link href={line.link.href} className="w-fit wrap-anywhere text-meta text-link underline underline-offset-2 hover:text-link-hover">{line.link.label}</Link>
                  ) : (
                    <span className="wrap-anywhere text-meta text-muted-ink">{line.link.label}</span>
                  )
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  const row = (line: DashboardLine) => {
    const title = titleOf(line);
    const inner = (
      <>
        {line.date ? (
          <span data-testid="tile-line-date" className={cn('shrink-0 tabular-nums text-hint', line.overdue ? 'font-semibold text-warning' : 'text-muted-ink')}>
            {fmt.date(line.date)}
          </span>
        ) : null}
        <span data-testid="tile-line-title" className="min-w-0 flex-1 text-pretty wrap-break-word text-body text-ink">
          {title}
          {/* Bezug ohne eigenes Ziel (Nummer eines Antrags) und Zusatz stehen leise hinter dem Text — ein Link in der
              Link-Zeile wäre verschachtelt. */}
          {line.link ? <span className="ml-2 text-hint whitespace-nowrap text-muted-ink">{line.link.label}</span> : null}
          {line.extra ? <span className="ml-2 text-hint text-muted-ink">{line.extra}</span> : null}
        </span>
        {line.trailing ? (
          <span data-testid="tile-line-trailing" className="shrink-0 text-body tabular-nums whitespace-nowrap text-ink">
            {line.trailing}
          </span>
        ) : null}
        {line.href ? <ChevronRight className="size-3.5 shrink-0 self-center text-muted-ink-2" aria-hidden /> : null}
      </>
    );
    const box = 'flex items-baseline gap-2.5 rounded-sm px-1.5 py-[9px]';
    return line.href ? (
      <Link href={line.href} className={cn(box, '-mx-1.5 hover:bg-hover')}>
        {inner}
      </Link>
    ) : (
      <div className={cn(box, '-mx-1.5')}>{inner}</div>
    );
  };

  return (
    <ul className={cn(variant === 'work' && 'columns-[300px] gap-x-7')}>
      {lines.map((line, index) => (
        <li key={`${index}-${line.title ?? line.titleKey}`} className={cn('border-b border-line-2', variant === 'work' ? 'break-inside-avoid' : 'last:border-b-0')}>
          {row(line)}
        </li>
      ))}
    </ul>
  );
}
