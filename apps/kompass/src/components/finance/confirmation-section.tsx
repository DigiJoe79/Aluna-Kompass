'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { IssueDialog } from '@/app/(shell)/finance/donations/issue-dialog';
import { useDateFormat } from '@/components/date-format-provider';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';

export interface ConfirmationSectionLine {
  lineId: string;
  /** Kategorie und Spender, wie sie in „Wofür?“ stehen. */
  label: string;
  amountCents: number;
  /** Ohne Spender lässt sich nichts bestätigen — dann steht das da statt „Ausstellen“. */
  hasContact: boolean;
  /** Die gültige Bestätigung auf dieser Zeile, sonst `null`. */
  confirmation: { id: string; number: string; issuedOn: string } | null;
}

/**
 * Abschnitt „Bestätigung“ der Buchungsansicht (C1, F6a Task 7): je
 * bescheinigungsfähiger Zeile „Bestätigung {number} vom {date}“ oder
 * „keine — Ausstellen“; ohne solche Zeile steht „keine — kein
 * Spendeneingang“ da (HANDOFF § 5.3: leere Bezüge stehen da).
 */
export function ConfirmationSection({ lines, canIssue, canDescribe, today }: { lines: ConfirmationSectionLine[]; canIssue: boolean; canDescribe: boolean; today: string }) {
  const t = useTranslations('finance.donations.entrySection');
  const { date } = useDateFormat();
  const [issuing, setIssuing] = useState<string | null>(null);

  return (
    <div data-testid="entry-confirmations" className="rounded-md border border-line bg-surface p-4">
      <Section title={t('title')}>
      {lines.length === 0 ? (
        <p className="text-meta text-muted-ink">{t('noDonation')}</p>
      ) : (
        <ul className="space-y-1.5 text-meta">
          {lines.map((line) => (
            <li key={line.lineId} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 py-1 last:border-0">
              <span className="text-ink-2">
                {line.label} · <span className="tabular-nums">{formatEuro(line.amountCents)}</span>
                {/* 07-2 A4: Die Aussage steht ausgeschrieben links in der Zeile, nicht als Wert vor dem Knopf. */}
                {line.confirmation ? null : <span className="block text-hint text-muted-ink">{line.hasContact ? t('none') : t('noContact')}</span>}
              </span>
              {line.confirmation ? (
                <Link href={`/finance/donations?confirmation=${line.confirmation.id}`} className="text-link underline">
                  {t('confirmed', { number: line.confirmation.number, date: date(line.confirmation.issuedOn) })}
                </Link>
              ) : (
                canIssue && line.hasContact ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setIssuing(line.lineId)}>{t('issue')}</Button>
                ) : null
              )}
            </li>
          ))}
        </ul>
      )}
      {issuing ? (
        <IssueDialog
          lineIds={[issuing]}
          open
          onOpenChange={(next) => {
            if (!next) setIssuing(null);
          }}
          today={today}
          canDescribe={canDescribe}
        />
      ) : null}
      </Section>
    </div>
  );
}
