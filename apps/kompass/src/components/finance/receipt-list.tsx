'use client';

import { useTranslations } from 'next-intl';
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
  const t = useTranslations('finance.receipt');
  if (items.length === 0) return <p className="text-[13px] text-muted-ink">{t('none')}</p>;

  return (
    <ul className="divide-y divide-line">
      {items.map((item) => (
        <li key={item.linkId} className={cn('flex items-center gap-2 py-2 text-[13px]', item.revoked && 'text-muted-ink')}>
          <span className={cn('font-mono text-[12px]', item.revoked && 'line-through')}>{item.documentNumber}</span>
          <span className={cn('min-w-0 flex-1 truncate', item.revoked && 'line-through')}>{item.title}</span>
          <span className="shrink-0 text-[12px] text-muted-ink">{item.typeLabel}</span>
          <span className="shrink-0 font-mono text-[12px] text-muted-ink">{item.date}</span>
          {item.revoked ? (
            item.replacedByNumber ? <span className="shrink-0 text-[12px]">{t('replacedBy', { number: item.replacedByNumber })}</span> : null
          ) : (
            <span className="flex shrink-0 items-center gap-2">
              <a href={item.viewHref} target="_blank" rel="noreferrer" className="font-semibold text-ink underline underline-offset-2">
                {t('open')}
              </a>
              {onRevoke ? (
                <button type="button" onClick={() => onRevoke(item.linkId)} className="text-ink-2 underline underline-offset-2">
                  {t('remove')}
                </button>
              ) : null}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
