'use client';

import type { RunPreviewItem } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Notice } from '@/components/notice';
import { formatEuro } from '@/lib/finance/amount';
import { groupRunItems, type RunGroupKey } from '@/lib/finance/run';
import { cn } from '@/lib/utils';

/** Wort und farbiger Oberstrich unterscheiden die Gruppen (README 3i) — nie die Farbe allein. */
const STROKE: Record<RunGroupKey, string> = {
  ready: 'border-t-success',
  needsSignature: 'border-t-warning',
  beforeOldestNotice: 'border-t-info',
  addressMissing: 'border-t-error',
  blocked: 'border-t-line-strong',
};

/**
 * Die Vorschau des Serienlaufs in Gruppen, gezählt in Bestätigungen: bereit ·
 * braucht Unterschrift (mit Grund) · vor dem ältesten Bescheid (mit
 * Pflichtbegründung für den Lauf) · Anschrift fehlt („Anschrift ergänzen“ zum
 * Kontakt) · blockiert (mit Grund). Je Zeile Spender, Art, Zuwendungen und
 * Betrag.
 */
export function PreviewGroups({ items, reason, onReasonChange, canIssue }: { items: readonly RunPreviewItem[]; reason: string; onReasonChange: (value: string) => void; canIssue: boolean }) {
  const t = useTranslations('finance.donations.run');
  const groups = groupRunItems(items);

  const linesText = (item: RunPreviewItem) =>
    item.alreadyConfirmedSingly > 0 ? t('linesWithSingly', { count: item.lineCount, all: item.lineCount + item.alreadyConfirmedSingly, singly: item.alreadyConfirmedSingly }) : t('lines', { count: item.lineCount });

  const blockedText = (item: RunPreviewItem) => {
    const key = item.blockedBy && item.blockedBy !== 'beforeOldestNotice' ? item.blockedBy : 'unknown';
    return t(`blockedBy.${key}`);
  };

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const headingId = `run-group-${group.key}-heading`;
        return (
          <section key={group.key} data-testid={`run-group-${group.key}`} aria-labelledby={headingId} className={cn('rounded-md border border-line border-t-[3px] bg-surface', STROKE[group.key])}>
            <h3 id={headingId} className="px-4 pt-3 pb-2 text-[13px] font-semibold text-ink">
              {t('groups.heading', { group: t(`groups.${group.key}`), count: group.items.length })}
            </h3>
            {group.key === 'beforeOldestNotice' ? (
              <div className="px-4 pb-3">
                {canIssue ? (
                  <Notice level="warn" reason={{ name: 'run-pre-notice-reason', value: reason, onChange: onReasonChange, label: t('beforeOldestNotice.reason') }}>
                    {t('beforeOldestNotice.text')}
                  </Notice>
                ) : (
                  <Notice level="hint">{t('beforeOldestNotice.text')}</Notice>
                )}
              </div>
            ) : null}
            <ul className="divide-y divide-line-2 border-t border-line-2 text-[13px]">
              {group.items.map((item) => (
                <li key={`${item.contactId}-${item.kind}-${item.inKindLineId ?? ''}`} data-testid="run-item" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="font-semibold text-ink">{item.contactName}</span>
                    <span className="text-ink-2">{t(`itemKind.${item.kind}`)}</span>
                    <span className="text-muted-ink">{linesText(item)}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-3">
                    {item.signatureReason && (group.key === 'needsSignature' || group.key === 'beforeOldestNotice') ? <span className="text-[12px] text-ink-2">{t(`signatureReason.${item.signatureReason}`)}</span> : null}
                    {group.key === 'addressMissing' ? (
                      <Link href={`/contacts/${item.contactId}`} className="rounded-sm border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-surface-2">
                        {t('completeAddress')}
                      </Link>
                    ) : null}
                    {group.key === 'blocked' ? (
                      <>
                        <span className="text-[12px] text-ink-2">{blockedText(item)}</span>
                        <Link href="/finance/donations?tab=uncertified" className="text-[12px] text-link underline">{t('openUncertified')}</Link>
                      </>
                    ) : null}
                    <span className="font-mono tabular-nums text-ink">{formatEuro(item.totalCents)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
