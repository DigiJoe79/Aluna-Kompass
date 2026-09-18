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
          <li key={`${index}-${title}`} className="flex items-center gap-3 py-2 text-[13px]">
            {line.action && canComplete ? (
              <Checkbox
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
            {line.date ? <span className={cn('font-mono text-[12px]', line.overdue ? 'text-warning' : 'text-ink-2')}>{fmt.date(line.date)}</span> : null}
            <span className="flex min-w-0 flex-1 items-baseline gap-3">
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
            {line.extra ? <span className="text-[12px] text-muted-ink">{line.extra}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
