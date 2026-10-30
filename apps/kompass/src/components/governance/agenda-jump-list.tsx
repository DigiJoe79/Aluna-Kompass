'use client';

import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { StatusBadge, type BadgeTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface AgendaJumpEntry {
  key: string;
  number: string;
  title: string;
  /** Ergebnis in einer Unterzeile („einstimmig“, „Lena Brückner, angenommen“). */
  summary: string | null;
  done: boolean;
  mark: { tone: BadgeTone; label: string } | null;
}

/**
 * Sprungliste des Mitlaufs (N4, Freigabe Joe 2026-10-28, Board Gremien 1a/1b/1h): ab `lg` die Tagesordnung als Liste,
 * je Punkt Haken oder Nummer, Titel, Ergebnis und Marke, der aktuelle mit `aria-current="step"` auf `primary-soft`;
 * darunter `footer` und die Tastenhilfe. Unter `lg` „TOP n von m“ als Auswahl mit ‹ ›.
 */
export function AgendaJumpList({ entries, current, onSelect, footer, label }: { entries: AgendaJumpEntry[]; current: string; onSelect: (key: string) => void; footer: ReactNode; label: string }) {
  const t = useTranslations('governance.live.jump');
  const index = Math.max(0, entries.findIndex((e) => e.key === current));
  return (
    <>
      <nav aria-label={label} className="flex flex-col gap-3 max-lg:hidden" data-testid="agenda-jump-list">
        <ol className="flex flex-col gap-0.5">
          {entries.map((e) => {
            const active = e.key === current;
            return (
              <li key={e.key}>
                <button
                  type="button"
                  aria-current={active ? 'step' : undefined}
                  onClick={() => onSelect(e.key)}
                  className={cn('flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-hover', active && 'bg-brand-soft')}
                  data-testid={`jump-${e.key}`}
                >
                  <span className="mt-0.5 flex w-5 shrink-0 justify-center text-meta tabular-nums text-muted-ink">
                    {e.done ? <Check className="size-4 text-success" aria-label={t('done')} /> : e.number}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-body text-ink">{e.done ? <span className="sr-only">{e.number} </span> : null}{e.title}</span>
                    {e.summary ? <span className="text-meta text-muted-ink">{e.summary}</span> : null}
                    {e.mark ? (
                      <span>
                        <StatusBadge tone={e.mark.tone} dot>{e.mark.label}</StatusBadge>
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {footer}
        <p className="text-hint text-muted-ink">{t('hint')}</p>
      </nav>
      <div className="flex items-center gap-2 lg:hidden" data-testid="agenda-jump-select">
        <Button type="button" variant="ghost" size="icon" aria-label={t('prev')} onClick={() => index > 0 && onSelect(entries[index - 1]!.key)}>
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <Select aria-label={t('choose')} value={current} onChange={(e) => onSelect(e.target.value)} className="min-w-0 flex-1">
          {entries.map((e) => (
            <option key={e.key} value={e.key}>{t('of', { n: e.number, total: entries.length })} · {e.title}</option>
          ))}
        </Select>
        <Button type="button" variant="ghost" size="icon" aria-label={t('next')} onClick={() => index < entries.length - 1 && onSelect(entries[index + 1]!.key)}>
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </>
  );
}
