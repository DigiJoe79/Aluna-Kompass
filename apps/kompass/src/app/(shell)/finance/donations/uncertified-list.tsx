'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { FilterBar } from '@/components/filter-bar';
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
  lines: { lineId: string; entryId: string; entryNumber: string | null; entryDate: string; netCents: number; incomeKind: string | null; warnings?: ('possibleReturnWithoutOrigin' | 'returnDraftPending')[]; inFuture?: true }[];
}

/**
 * „Noch nicht bestätigt“ (C1): Zuwendungen ohne gültige Bestätigung, je
 * Person, mit dem Filter „Spenden ab ‹Betrag› ohne Bestätigung“ (gegen die
 * Summe je Person). Fehlt die Anschrift, steht der Weg zum Kontakt da;
 * „Ausstellen“ je Zeile öffnet den Dialog — nur mit `finance.donationsIssue`.
 */
export function UncertifiedList({
  groups,
  minCents,
  count,
  canIssue,
  canDescribe,
  today,
}: {
  groups: UncertifiedGroupRow[];
  minCents: number | null;
  /** Personen mit dem Mindestbetrag und ohne — die Zählzeile. */
  count: { shown: number; total: number };
  canIssue: boolean;
  canDescribe: boolean;
  today: string;
}) {
  const t = useTranslations('finance.donations.uncertified');
  const tk = useTranslations('finance.admin.categories.incomeKinds');
  const { date } = useDateFormat();
  const router = useRouter();
  const [min, setMin] = useState(minCents !== null ? formatAmount(minCents) : '');
  const [issuing, setIssuing] = useState<string | null>(null);

  const [, startNavigation] = useTransition();
  // Der Betrag gilt bei Enter oder beim Verlassen des Felds — kein Knopf „Anwenden“ (Spec Filterleisten § 4).
  const apply = (text: string) => {
    const cents = parseAmount(text);
    const next = cents !== null && cents > 0 ? cents : null;
    if (next === minCents) return;
    startNavigation(() => router.replace(next !== null ? `/finance/donations?tab=uncertified&min=${next}` : '/finance/donations?tab=uncertified'));
  };
  const reset = () => {
    setMin('');
    apply('');
  };
  const field = (id: string, value: string, onChange: (text: string) => void) => (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-meta text-ink-2">
        {t('filterMin')}
      </label>
      {/* 390 px: Das Feld nimmt am Telefon die volle Breite (Pipeline-Warnung fl-zuwendungen-offen; ohne Layout-Test). */}
      <div className="w-36 max-sm:w-full">
        <AmountField id={id} name="min" value={value} onChange={onChange} />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <FilterBar
        filters={[
          {
            key: 'min',
            label: t('filterMin'),
            active: minCents !== null,
            chip: minCents !== null ? formatEuro(minCents) : undefined,
            onClear: reset,
            control: (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  apply(min);
                }}
                onBlur={(e) => {
                  if (e.target instanceof HTMLInputElement) apply(e.target.value);
                }}
              >
                {field('uncertified-min', min, setMin)}
              </form>
            ),
            sheet: { value: min, render: (value, onChange) => field('uncertified-min-sheet', value, onChange), apply },
          },
        ]}
        count={{ ...count, noun: { one: t('nounOne'), other: t('nounOther'), dative: t('nounDative') } }}
        onReset={reset}
      />

      {groups.length === 0 && minCents !== null ? (
        // Befund 11: Der Mindestbetrag blendet alles aus — das ist nicht „Alles bestätigt“.
        <EmptyState filtered={{ noun: t('emptyFilteredNoun'), onReset: reset }} />
      ) : groups.length === 0 ? (
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
                  // 390 px: Zeile und linke Gruppe brechen um, Betrag und Knopf rücken nach rechts (Pipeline-Warnung
                  // fl-zuwendungen-offen, Überlauf 411 > 390; ohne Layout-Test, Projektregel).
                  <li key={line.lineId} data-testid="uncertified-line" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      <Link href={`/finance/entries/${line.entryId}`} className="font-mono text-link underline">{line.entryNumber ?? line.entryId}</Link>
                      <span className="text-ink-2">{date(line.entryDate)}</span>
                      <span className="text-muted-ink">{line.incomeKind ? tk(line.incomeKind) : ''}</span>
                      {line.warnings?.includes('possibleReturnWithoutOrigin') ? (
                        <StatusBadge tone="warning">{t('possibleReturnWithoutOrigin')}</StatusBadge>
                      ) : null}
                      {line.warnings?.includes('returnDraftPending') ? <StatusBadge tone="warning">{t('returnDraftPending')}</StatusBadge> : null}
                    </span>
                    <span className="ml-auto flex items-center gap-3">
                      <span className="font-mono whitespace-nowrap tabular-nums">{formatEuro(line.netCents)}</span>
                      {/* Befund 59: Ein Datum nach heute ist noch nicht ausstellbar — der Hinweis statt des Knopfs. */}
                      {line.inFuture ? (
                        <span className="text-[12px] text-muted-ink">{t('inFuture')}</span>
                      ) : canIssue ? (
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
