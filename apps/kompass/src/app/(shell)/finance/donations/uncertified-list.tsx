'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { AmountField } from '@/components/finance/amount-field';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { IssueDialog } from './issue-dialog';

export interface UncertifiedGroupRow {
  contactId: string;
  contactName: string;
  contactComplete: boolean;
  sumCents: number;
  lines: { lineId: string; entryId: string; entryNumber: string | null; entryDate: string; netCents: number; incomeKind: string | null }[];
}

/**
 * „Noch nicht bestätigt“ (C1): Zuwendungen ohne gültige Bestätigung, je
 * Person, mit dem Filter „Spenden ab ‹Betrag› ohne Bestätigung“ (gegen die
 * Summe je Person). Fehlt die Anschrift, steht der Weg zum Kontakt da;
 * „Ausstellen“ je Zeile öffnet den Dialog — nur mit `finance.donationsIssue`.
 */
export function UncertifiedList({ groups, minCents, canIssue, canDescribe, today }: { groups: UncertifiedGroupRow[]; minCents: number | null; canIssue: boolean; canDescribe: boolean; today: string }) {
  const t = useTranslations('finance.donations.uncertified');
  const tk = useTranslations('finance.admin.categories.incomeKinds');
  const { date } = useDateFormat();
  const router = useRouter();
  const [min, setMin] = useState(minCents !== null ? formatAmount(minCents) : '');
  const [issuing, setIssuing] = useState<string | null>(null);

  const apply = () => {
    const cents = parseAmount(min);
    router.push(cents !== null && cents > 0 ? `/finance/donations?tab=uncertified&min=${cents}` : '/finance/donations?tab=uncertified');
  };

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-center gap-2 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label htmlFor="uncertified-min" className="text-ink-2">{t('filterBefore')}</label>
        <div className="w-36">
          <AmountField id="uncertified-min" name="min" value={min} onChange={setMin} />
        </div>
        <span className="text-ink-2">{t('filterAfter')}</span>
        <Button type="submit" variant="outline" size="sm">{t('apply')}</Button>
        {minCents !== null ? (
          <Link href="/finance/donations?tab=uncertified" className="text-link underline">{t('reset')}</Link>
        ) : null}
      </form>

      {groups.length === 0 ? (
        <EmptyState title={t('empty.title')} text={t('empty.text')} />
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={group.contactId} data-testid="uncertified-group" className="rounded-md border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Link href={`/contacts/${group.contactId}`} className="font-semibold text-ink underline-offset-2 hover:underline">{group.contactName}</Link>
                  {group.contactComplete ? null : <StatusBadge tone="warning">{t('addressMissing')}</StatusBadge>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono tabular-nums text-ink-2">{t('sum', { amount: formatEuro(group.sumCents) })}</span>
                  {group.contactComplete ? null : (
                    <Link href={`/contacts/${group.contactId}`} className="rounded-sm border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-surface-2">
                      {t('completeAddress')}
                    </Link>
                  )}
                </div>
              </div>
              <ul className="mt-2 divide-y divide-line-2 text-[13px]">
                {group.lines.map((line) => (
                  <li key={line.lineId} data-testid="uncertified-line" className="flex items-center justify-between gap-3 py-1.5">
                    <span className="flex items-center gap-3">
                      <Link href={`/finance/entries/${line.entryId}`} className="font-mono text-link underline">{line.entryNumber ?? line.entryId}</Link>
                      <span className="text-ink-2">{date(line.entryDate)}</span>
                      <span className="text-muted-ink">{line.incomeKind ? tk(line.incomeKind) : ''}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono tabular-nums">{formatEuro(line.netCents)}</span>
                      {canIssue ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => setIssuing(line.lineId)}>{t('issue')}</Button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {issuing ? (
        <IssueDialog
          lineId={issuing}
          contactName={groups.find((g) => g.lines.some((line) => line.lineId === issuing))?.contactName}
          open
          onOpenChange={(next) => {
            if (!next) setIssuing(null);
          }}
          today={today}
          canDescribe={canDescribe}
        />
      ) : null}
    </div>
  );
}
