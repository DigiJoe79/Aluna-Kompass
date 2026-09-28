'use client';

import type { RunExcludedContact, RunPreviewItem } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { formatEuro } from '@/lib/finance/amount';
import { groupRunItems, type RunGroupKey } from '@/lib/finance/run';
import { cn } from '@/lib/utils';

/** Wort und farbiger Oberstrich unterscheiden die Gruppen (README 3i) — nie die Farbe allein. */
const STROKE: Record<RunGroupKey, string> = {
  ready: 'border-t-success',
  needsSignature: 'border-t-warning',
  addressMissing: 'border-t-error',
  blocked: 'border-t-line-strong',
};

/**
 * Die Vorschau des Serienlaufs in Gruppen, gezählt in Bestätigungen: bereit ·
 * braucht Unterschrift (mit Grund) · Anschrift fehlt („Anschrift ergänzen“
 * zum Kontakt) · blockiert (mit Grund — auch vor Beginn der
 * Steuerbefreiung). Je Zeile Spender, Art, Zuwendungen und Betrag.
 */
export function PreviewGroups({ items, excluded = [] }: { items: readonly RunPreviewItem[]; excluded?: readonly RunExcludedContact[] }) {
  const t = useTranslations('finance.donations.run');
  const groups = groupRunItems(items);
  // N3: „x von y Zeilen ausgeschlossen“ am Posten eines teilweise ausgeschlossenen Spenders.
  const excludedByContact = new Map(excluded.map((e) => [e.contactId, e] as const));

  const linesText = (item: RunPreviewItem) =>
    item.alreadyConfirmedSingly > 0 ? t('linesWithSingly', { count: item.lineCount, all: item.lineCount + item.alreadyConfirmedSingly, singly: item.alreadyConfirmedSingly }) : t('lines', { count: item.lineCount });

  const blockedText = (item: RunPreviewItem) => {
    const key = item.blockedBy ?? 'unknown';
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
            <ul className="divide-y divide-line-2 border-t border-line-2 text-[13px]">
              {group.items.map((item) => (
                <li key={`${item.contactId}-${item.kind}-${item.inKindLineId ?? ''}`} data-testid="run-item" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="font-semibold text-ink">{item.contactName}</span>
                    <span className="text-ink-2">{t(`itemKind.${item.kind}`)}</span>
                    <span className="text-muted-ink">{linesText(item)}</span>
                    {item.excludedPossibleReturn > 0 ? <span className="text-[12px] text-ink-2">{t('excludedPossibleReturn')}</span> : null}
                    {item.excludedReturnDraft > 0 ? <span className="text-[12px] text-ink-2">{t('excludedReturnDraft')}</span> : null}
                    {item.excludedInFuture > 0 ? <span className="text-[12px] text-ink-2">{t('excludedInFuture', { count: item.excludedInFuture })}</span> : null}
                    {excludedByContact.has(item.contactId) ? (
                      <span className="text-[12px] text-ink-2">{t('excludedPartly', { excluded: excludedByContact.get(item.contactId)!.excludedLineCount, all: excludedByContact.get(item.contactId)!.lineCount })}</span>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-3">
                    {item.signatureReason && group.key === 'needsSignature' ? <span className="text-[12px] text-ink-2">{t(`signatureReason.${item.signatureReason}`)}</span> : null}
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
      {excluded.length > 0 ? (
        <section data-testid="run-group-excluded" aria-labelledby="run-group-excluded-heading" className="rounded-md border border-line border-t-[3px] border-t-line-strong bg-surface">
          <h3 id="run-group-excluded-heading" className="px-4 pt-3 pb-2 text-[13px] font-semibold text-ink">
            {t('excluded.heading', { count: excluded.length })}
          </h3>
          <ul className="divide-y divide-line-2 border-t border-line-2 text-[13px]">
            {excluded.map((e) => (
              <li key={e.contactId} data-testid="run-excluded-contact" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-semibold text-ink">{e.contactName}</span>
                  <span className="text-ink-2">{e.reasons.map((r) => t(`excluded.reason.${r}`)).join(' · ')}</span>
                  <span className="text-muted-ink">{t('excludedPartly', { excluded: e.excludedLineCount, all: e.lineCount })}</span>
                </span>
                <span className="flex flex-wrap items-center gap-3">
                  {e.blockingEntries.map((b) => (
                    <Link key={b.entryId} href={b.href} className="text-[12px] text-link underline">
                      {b.entryNumber ? t('excluded.openEntry', { number: b.entryNumber }) : t('excluded.openDraft')}
                    </Link>
                  ))}
                  <span className="font-mono tabular-nums text-ink">{formatEuro(e.excludedCents)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
