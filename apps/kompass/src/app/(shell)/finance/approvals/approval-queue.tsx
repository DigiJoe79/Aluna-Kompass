'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

export interface QueueRow {
  claimId: string;
  number: string;
  kind: 'expenseClaim' | 'waiver';
  person: string;
  amount: string;
  since: string;
}

/**
 * Die Warteschlange „Wartet auf Ihre Freigabe“ (Designer-README 3h): älteste
 * oben, je Eintrag die Art als umrandetes Kennzeichen, Person, Betrag und
 * „seit …“. Pfeil hoch/runter wechselt wie in der Akte; der Fokus bleibt in
 * der Liste. Kein Kürzel für Freigeben — das ist bewusst ein Klick.
 */
export function ApprovalQueue({ rows, selectedId }: { rows: QueueRow[]; selectedId: string | null }) {
  const t = useTranslations('finance.approvals');
  const router = useRouter();
  const links = useRef(new Map<string, HTMLAnchorElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const current = rows.findIndex((r) => r.claimId === selectedId);
    const next = rows[Math.min(rows.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (!next || next.claimId === selectedId) return;
    links.current.get(next.claimId)?.focus();
    router.push(`/finance/approvals?claim=${next.claimId}`);
  };

  return (
    <section data-testid="approval-queue" aria-labelledby="approval-queue-title" className="space-y-2">
      <h3 id="approval-queue-title" className="text-[13px] font-semibold text-muted-ink">
        {t('queue.title')}
      </h3>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong bg-surface p-4 text-[14px] text-muted-ink">{t('queue.empty')}</p>
      ) : (
        <ul className="space-y-2" onKeyDown={onKeyDown}>
          {rows.map((row) => {
            const selected = row.claimId === selectedId;
            return (
              <li key={row.claimId}>
                <Link
                  ref={(el) => {
                    if (el) links.current.set(row.claimId, el);
                    else links.current.delete(row.claimId);
                  }}
                  href={`/finance/approvals?claim=${row.claimId}`}
                  data-testid="approval-queue-item"
                  aria-current={selected ? 'true' : undefined}
                  className={cn(
                    'flex min-h-16 flex-col gap-1 rounded-lg border p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    selected ? 'border-line-strong bg-selected text-selected-ink' : 'border-line bg-surface hover:bg-hover',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="rounded-sm border border-line-strong px-1.5 py-0.5 text-[11px] font-semibold">{t(`kind.${row.kind}`)}</span>
                      <span className="font-mono text-[13px] font-semibold">{row.number}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[14px] font-semibold tabular-nums">{row.amount}</span>
                  </span>
                  <span className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="min-w-0 truncate">{row.person}</span>
                    <span className="shrink-0 text-[12px] opacity-80">{t('queue.since', { date: row.since })}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
