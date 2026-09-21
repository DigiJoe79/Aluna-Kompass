'use client';

import type { DashboardLine } from '@kompass/core';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { completeDueAction } from '../due-actions';

/**
 * Die Zeilen einer `list`-Kachel — dasselbe Muster wie der frühere
 * Fällig-Kasten: Datum in Mono, Anlass, Bezug als Link daneben, Zusatz
 * rechts. Das Häkchen ist die einzige Aktion auf der Startseite.
 */
export function TileLines({ ns, lines, canComplete }: { ns: string; lines: DashboardLine[]; canComplete: boolean }) {
  const t = useTranslations('dashboard');
  const fmt = useDateFormat();
  const router = useRouter();
  const [, start] = useTransition();

  const titleOf = (line: DashboardLine) => line.title ?? (line.titleKey ? t(`${ns}.messages.${line.titleKey}`, line.values ?? {}) : '');

  return (
    <ul className="divide-y divide-line-2">
      {lines.map((line, index) => {
        const title = titleOf(line);
        return (
          <li
            key={`${index}-${title}`}
            className="flex min-h-[46px] flex-col flex-wrap items-start gap-x-3 gap-y-0.5 py-2 text-[13px] min-[391px]:flex-row min-[391px]:items-center"
          >
            {line.action && canComplete ? (
              <Checkbox
                className="order-1"
                aria-label={t('complete', { title })}
                onCheckedChange={() =>
                  start(async () => {
                    const s = await completeDueAction(line.action!.followUpId);
                    if (s.status === 'error') toast.error(s.message);
                    else router.refresh();
                  })
                }
              />
            ) : null}
            {/* Bis 390 px (einschließlich) steht das Datum unter dem Satz (order 3 vs. 2); ab 391 px wieder davor (order 2 vs. 3) — das einzige responsive Verhalten dieser Komponente. */}
            <span data-testid="tile-line-title" className="order-2 flex min-w-0 flex-1 items-baseline gap-3 min-[391px]:order-3">
              {line.href ? (
                <Link href={line.href} className="truncate text-ink underline-offset-2 hover:underline">{title}</Link>
              ) : (
                <span className="truncate text-ink">{title}</span>
              )}
              {line.link ? (
                line.link.href ? (
                  <Link href={line.link.href} className="truncate font-mono text-[12px] underline underline-offset-2 hover:text-link">{line.link.label}</Link>
                ) : (
                  <span className="truncate font-mono text-[12px] text-muted-ink">{line.link.label}</span>
                )
              ) : null}
            </span>
            {line.date ? (
              <span data-testid="tile-line-date" className={cn('order-3 font-mono text-[12px] min-[391px]:order-2', line.overdue ? 'text-warning' : 'text-ink-2')}>{fmt.date(line.date)}</span>
            ) : null}
            {line.extra ? <span className="order-4 text-[12px] text-muted-ink">{line.extra}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
