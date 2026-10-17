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
        <li key={item.linkId} className={cn('flex items-start gap-2 py-2 text-meta', item.revoked && 'text-muted-ink')}>
          {/* Runde 3, 089: Nummer und Betreff in der ersten Zeile, der Betreff bricht um statt zu kürzen; Art und Datum
              darunter. */}
          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="block">
              <span className={cn('font-mono text-hint', item.revoked && 'line-through')}>{item.documentNumber}</span>
              {/* 07-2 A5: Der Betreff steht an zweiter Stelle; die Nummer nicht noch einmal. */}
              {item.title !== item.documentNumber ? <> <span className={cn('break-words', item.revoked && 'line-through')}>{item.title}</span></> : null}
            </span>
            <span className="block text-hint text-muted-ink">
              {item.typeLabel ? <>{item.typeLabel} · </> : null}
              <span className="tabular-nums">{date(item.date)}</span>
              {item.revoked && item.replacedByNumber ? <> · {t('replacedBy', { number: item.replacedByNumber })}</> : null}
            </span>
          </span>
          {item.revoked ? null : (
            <span className="flex shrink-0 items-center gap-2">
              {/* 07-2 A5, Runde 3, 089: „Öffnen“ als Textknopf, „Entfernen“ sekundär (`outline`, § C). */}
              <a href={item.viewHref} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
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
