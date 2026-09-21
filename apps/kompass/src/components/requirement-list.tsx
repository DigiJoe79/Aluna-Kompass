import Link from 'next/link';
import type { ReactNode } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { cn } from '@/lib/utils';

export interface RequirementListItem {
  key: string;
  title: string;
  /** Erledigt bleibt sichtbar — nicht ausgeblendet, nur ruhiger dargestellt. */
  done: boolean;
  /** Wartet auf eine Abhängigkeit; `blockedText` sagt, worauf. */
  blocked: boolean;
  blockedText?: string;
  /** Zusatzangabe, z. B. „2 Konten, 1 ohne Anfangsbestand“. */
  detail?: string;
  /** Der Betrachter kann den Schritt selbst erledigen. */
  canSelf: boolean;
  /** Namen derer, die es erledigen können, wenn der Betrachter es nicht selbst kann. */
  canDoNames: string[];
  canDoText: string;
  href: string;
  actionLabel: string;
  doneLabel: string;
  /** Zusätzliche Aktion neben dem Sprung-Knopf, z. B. „Vorgaben übernehmen“. */
  extra?: ReactNode;
}

/**
 * Generische Einrichtungs-Checkliste (H1, `components/`): erledigte Zeilen
 * bleiben stehen, offene liegen auf `bg-surface-2`, blockierte nennen ihre
 * Abhängigkeit, und wer den Schritt nicht selbst erledigen kann, liest, wer es
 * kann. Kein Finanzwort im Baustein selbst — die Beschriftung kommt vom Aufrufer.
 */
export function RequirementList({ items }: { items: RequirementListItem[] }) {
  return (
    <ul className="space-y-2" data-testid="requirement-list">
      {items.map((item) => (
        <li
          key={item.key}
          data-testid={`requirement-${item.key}`}
          data-done={item.done}
          data-blocked={item.blocked}
          className={cn(
            'flex flex-col gap-2 rounded-md border border-line p-3.5 sm:flex-row sm:items-center sm:justify-between',
            item.done ? 'bg-surface' : 'bg-surface-2',
          )}
        >
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <StatusBadge tone={item.done ? 'success' : item.blocked ? 'neutral' : 'warning'}>
                {item.done ? item.doneLabel : item.blocked ? item.blockedText : item.actionLabel}
              </StatusBadge>
              <span className="font-semibold text-ink">{item.title}</span>
            </div>
            {item.detail ? <p className="text-[13px] text-muted-ink">{item.detail}</p> : null}
            {!item.done && !item.blocked && !item.canSelf && item.canDoNames.length > 0 ? (
              <p className="text-[12px] text-muted-ink" data-testid={`requirement-${item.key}-candoo`}>
                {item.canDoText}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {item.extra}
            {!item.done && !item.blocked && item.canSelf ? (
              <Link href={item.href} className="rounded-sm border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-surface-2">
                {item.actionLabel}
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
