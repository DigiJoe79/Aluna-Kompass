'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { formatEuro } from '@/lib/finance/amount';
import { formatDateOrDash } from '@/lib/finance/dates';
import { ibanLastFour } from '@/lib/finance/iban-check';
import { formatIban, maskIban } from '@kompass/module-finance/format';

export interface AccountCardData {
  accountId: string;
  name: string;
  kind: 'bank' | 'cash' | 'paymentService';
  iban: string | null;
  balanceCents: number;
  withReviewedCents: number;
  lastCount: { countedOn: string; countedCents: number } | null;
  /** Nur `bank`/`paymentService` (F4 Task 7, Spec 9.3): `null` heißt „noch nie importiert“. */
  statement: {
    importedThrough: string | null;
    lastStatementDaysAgo: number | null;
    /** Befund 5: der Auszug reicht über heute hinaus — statt „vor 0 Tagen“. */
    lastStatementInFuture: boolean;
    /** Ab diesem Wert gilt der letzte Auszug als überfällig (`finance.lastStatementWarnDays`). */
    warnDays: number;
    reconciliation: { state: 'matches' | 'differs' | 'noStatement'; statementDate: string | null; differenceCents: number | null } | null;
  } | null;
}

/**
 * Eine Konto-Karte (HANDOFF § 5.5, Task 3): Bestand festgeschrieben groß,
 * geprüfte Entwürfe nur, wenn sie abweichen; eine Kasse nennt neutral, wann
 * sie zuletzt gezählt wurde — ohne Warnfarbe, ohne Badge. Die ganze Karte ist
 * das Klickziel ins gefilterte Journal (HANDOFF § 5.5), bei einer Kasse auf die Kassenseite — der Aufdeck-Knopf
 * stoppt seinen eigenen Klick, statt in einem verschachtelten Link zu stecken
 * (Muster `journal.tsx`).
 */
export function AccountCard({ account }: { account: AccountCardData }) {
  const t = useTranslations('finance.accounts');
  const tf = useTranslations('finance.common');
  const router = useRouter();
  const { date } = useDateFormat();
  const [revealed, setRevealed] = useState(false);
  // Eine Kasse steht in „Konten“ und in „Kassen“; ihre Karte führt auf die Arbeitsseite der Kasse (zählen, bewegen),
  // ein Bank- oder Zahlungsdienstkonto ins gefilterte Journal (Joe 2026-10-17).
  const href = account.kind === 'cash' ? `/finance/cash?account=${account.accountId}` : `/finance/entries?account=${account.accountId}`;

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') router.push(href);
      }}
      className="cursor-pointer rounded-lg border border-line bg-surface p-4 hover:bg-row-hover"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">{account.name}</p>
          <p className="text-hint text-muted-ink">{t(`kind.${account.kind}`)}</p>
        </div>
      </div>

      {account.kind === 'bank' && account.iban ? (
        <div className="mt-2 flex items-center gap-2 font-mono text-meta text-ink-2">
          {revealed ? (
            <span data-testid="iban-value">{formatIban(account.iban)}</span>
          ) : (
            // Verdeckt: sehend „DE ·· 2051“, für Vorleser ein Satz statt zweier Punkte (Designer 2026-10-16, Teil 1 Nr. 3).
            <>
              <span data-testid="iban-value" aria-hidden="true">
                {maskIban(account.iban)}
              </span>
              <span className="sr-only">{tf('ibanEndsWith', { last: ibanLastFour(account.iban) })}</span>
            </>
          )}
          <button
            type="button"
            aria-label={revealed ? t('ibanHide') : t('ibanReveal')}
            onClick={(e) => {
              e.stopPropagation();
              setRevealed((v) => !v);
            }}
            className="text-muted-ink hover:text-ink"
          >
            {revealed ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
          </button>
        </div>
      ) : null}

      <div className="mt-3">
        <p className="text-amount font-semibold tabular-nums text-ink">{formatEuro(account.balanceCents)}</p>
        {account.withReviewedCents !== account.balanceCents ? (
          <p className="text-hint text-muted-ink">{t('withReviewed', { amount: formatEuro(account.withReviewedCents) })}</p>
        ) : null}
      </div>

      {account.kind === 'cash' ? (
        <p className="mt-2 text-hint text-muted-ink">
          {account.lastCount ? t('lastCount', { date: date(account.lastCount.countedOn), amount: formatEuro(account.lastCount.countedCents) }) : t('neverCounted')}
        </p>
      ) : null}

      {account.statement ? (
        <div className="mt-2 space-y-0.5">
          {account.statement.importedThrough === null ? (
            <p className="text-hint text-muted-ink">{t('statementNone')}</p>
          ) : (
            <p className={account.statement.lastStatementDaysAgo !== null && account.statement.lastStatementDaysAgo >= account.statement.warnDays ? 'text-hint font-semibold text-warning' : 'text-hint text-muted-ink'}>
              {t('statementThrough', { date: formatDateOrDash(date, account.statement.importedThrough) })}
              {account.statement.lastStatementInFuture
                ? ` · ${t('statementInFuture')}`
                : account.statement.lastStatementDaysAgo !== null
                  ? ` · ${t('statementDaysAgo', { days: account.statement.lastStatementDaysAgo })}`
                  : ''}
            </p>
          )}
          {/* 07-2 B8: „Kein Auszug für heute“ unter jedem Konto sagt nichts — die Zeile steht nur mit einem Abgleich. */}
          {account.statement.reconciliation && account.statement.reconciliation.state !== 'noStatement' ? (
            <p className={account.statement.reconciliation.state === 'differs' ? 'text-hint font-semibold text-warning' : 'text-hint text-muted-ink'}>
              {account.statement.reconciliation.state === 'matches'
                ? t('reconciliation.matches', { date: formatDateOrDash(date, account.statement.reconciliation.statementDate) })
                : t('reconciliation.differs', { date: formatDateOrDash(date, account.statement.reconciliation.statementDate), amount: formatEuro(account.statement.reconciliation.differenceCents ?? 0) })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
