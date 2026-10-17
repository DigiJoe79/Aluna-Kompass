'use client';

import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ReceiptListItem {
  linkId: string;
  documentNumber: string;
  title: string;
  typeLabel: string;
  date: string;
  viewHref: string;
  revoked: boolean;
  replacedByNumber?: string | null;
}

/**
 * Die Belegliste einer Buchung (HANDOFF § 2.8). Ein widerrufener Beleg wird
 * nicht entfernt, sondern durchgestrichen und auf seinen Ersatz verwiesen —
 * die Prüfung muss sehen, dass er einmal dort hing.
 */
export function ReceiptList({ items, onRevoke }: { items: ReceiptListItem[]; onRevoke?: (linkId: string) => void }) {
  const { date } = useDateFormat();
  const t = useTranslations('finance.receipt');
  if (items.length === 0) return <p className="text-meta text-muted-ink">{t('none')}</p>;

  return (
    <ul className="divide-y divide-line">
      {items.map((item) => (
        <li key={item.linkId} className={cn('flex items-center gap-2 py-2 text-meta', item.revoked && 'text-muted-ink')}>
          <span className={cn('font-mono text-hint', item.revoked && 'line-through')}>{item.documentNumber}</span>
          {/* 07-2 A5: Der Betreff steht an zweiter Stelle; die Nummer nicht noch einmal. */}
          <span className={cn('min-w-0 flex-1 truncate', item.revoked && 'line-through')}>{item.title !== item.documentNumber ? item.title : null}</span>
          {item.typeLabel ? <span className="shrink-0 text-hint text-muted-ink">{item.typeLabel}</span> : null}
          <span className="tabular-nums shrink-0 text-hint text-muted-ink">{date(item.date)}</span>
          {item.revoked ? (
            item.replacedByNumber ? <span className="shrink-0 text-hint">{t('replacedBy', { number: item.replacedByNumber })}</span> : null
          ) : (
            <span className="flex shrink-0 items-center gap-2">
              {/* 07-2 A5: „Öffnen“ und „Entfernen“ als Knöpfe; Entfernen in der Zeile ist `outline` (§ C). */}
              <a href={item.viewHref} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('open')}
              </a>
              {onRevoke ? (
                <Button type="button" variant="outline" size="sm" onClick={() => onRevoke(item.linkId)}>
                  {t('remove')}
                </Button>
              ) : null}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
