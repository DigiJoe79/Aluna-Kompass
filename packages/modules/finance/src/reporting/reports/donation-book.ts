import { paperDate, type DbOrTx } from '@kompass/core';
import { donationBookInternal, donationReconciliationInternal, type DonationBook, type DonationBookKind, type DonationReconciliation, type ReconciliationReasonKey } from '../../donations/book';
import { formatEuro } from '../../format/amount';
import type { ReportComputeEnv, ReportDefinition, ReportParams, ReportRenderContext } from '../types';
import { amountCell, checkYearOrDate, heading, paragraph, reportYearInternal, strongAmountCell, strongCell, table, textCell, yearParamsSchema } from './common';

/**
 * Spendenbuch mit Abstimmung (Finanz-Spec § 9.2, Rechenschaft B1 Task 6): alle Zuwendungen des Kalenderjahres mit
 * Stand der Bestätigung, dazu die Abstimmung mit den Bestätigungen. Kalenderjahr statt Geschäftsjahr, weil
 * Bestätigungen je Kalenderjahr gelten: das Jahr von `endsOn` (Entscheidung 5 des Plans). Die Grenze des
 * vereinfachten Nachweises gilt zum 31.12. — so bleibt die Rechnung rein. Mit Personenbezug.
 */

export interface DonationBookReport {
  calendarYear: number;
  book: DonationBook;
  reconciliation: DonationReconciliation;
}

const FEES_KEY = 'finance.membershipFeesCertifiable';
const MINIMUM_KEY = 'finance.batchMinimumCents';

export function computeDonationBookReport(db: DbOrTx, params: ReportParams, env: ReportComputeEnv): DonationBookReport {
  const calendarYear = Number(reportYearInternal(db, params.fiscalYearId!).endsOn.slice(0, 4));
  const feesCertifiable = env.settings[FEES_KEY] !== false;
  const minCents = typeof env.settings[MINIMUM_KEY] === 'number' ? (env.settings[MINIMUM_KEY] as number) : 0;
  return {
    calendarYear,
    book: donationBookInternal(db, calendarYear, feesCertifiable),
    reconciliation: donationReconciliationInternal(db, calendarYear, { feesCertifiable, minCents, limitDate: `${calendarYear}-12-31` }),
  };
}

// ── Papier ─────────────────────────────────────────────────────────────────

/** Dieselben Wörter wie das Spendenbuch der Oberfläche (`finance.donations.book`). */
const KIND_TEXT: Record<DonationBookKind, string> = { donation: 'Geld', membershipFee: 'Mitgliedsbeitrag', inKindDonation: 'Sache', expenseWaiver: 'Aufwandsspende' };
const SUM_TEXT: Record<DonationBookKind, string> = { donation: 'Geld', membershipFee: 'Mitgliedsbeiträge', inKindDonation: 'Sache', expenseWaiver: 'Aufwandsspende' };
const REASON_TEXT: Record<ReconciliationReasonKey, string> = {
  belowMinimum: 'Unter dem Mindestbetrag',
  addressMissing: 'Anschrift fehlt',
  inKindUndescribed: 'Sachspende nicht beschrieben',
  expenseWaiverUnconfirmed: 'Aufwandsspende nicht bestätigt',
  anonymous: 'Anonym, ohne Kontakt',
  other: 'Sonstige',
  confirmedAboveReturns: 'Bestätigt über Rückgaben hinaus',
  returnOtherYear: 'Rückgabe in einem anderen Jahr',
};

export function donationBookTypst(data: DonationBookReport, _ctx: ReportRenderContext): string {
  const { book, reconciliation } = data;
  // Kein zweites „Spendenbuch“ unter dem Titel (Designer Runde 7, 264).
  const parts: string[] = [];
  if (book.rows.length === 0) parts.push(paragraph('Im Kalenderjahr gibt es keine Zuwendungen.'));
  else {
    // Die Spalte „Zweck“ nur, wenn ein Eintrag einen trägt (Designer Runde 6, 264).
    const withPurpose = book.rows.some((r) => r.purposeName);
    parts.push(
      table(
        withPurpose ? '(20mm, 24mm, 1fr, 22mm, 32mm, 24mm, 26mm)' : '(20mm, 24mm, 1fr, 22mm, 24mm, 26mm)',
        ['Datum', 'Nr.', 'Zuwendende', 'Art', ...(withPurpose ? ['Zweck'] : []), 'in €', 'Bestätigung'],
        book.rows.map((r) => [
          textCell(paperDate(r.entryDate as never)),
          textCell(r.entryNumber ?? ''),
          textCell(r.contactId === null ? 'anonym' : (r.contactName ?? '')),
          textCell(KIND_TEXT[r.kind]),
          ...(withPurpose ? [textCell(r.purposeName ?? '')] : []),
          amountCell(r.amountCents),
          textCell(r.confirmation?.number ?? ''),
        ]),
      ),
    );
  }
  const kinds = (Object.keys(SUM_TEXT) as DonationBookKind[]).filter((k) => k !== 'membershipFee' || book.membershipFeesCertifiable);
  parts.push(table('(1fr, 32mm)', ['in €', 'Summe'], [...kinds.map((k) => [textCell(SUM_TEXT[k]), amountCell(book.sums[k])]), [strongCell('Zusammen'), strongAmountCell(book.sums.total)]]));

  parts.push(heading(2, 'Abstimmung mit den Bestätigungen'));
  const rows = [
    [textCell('Zuwendungen'), amountCell(reconciliation.donationsCents)],
    [textCell('Bestätigt'), amountCell(reconciliation.confirmedCents)],
    [strongCell('Differenz'), strongAmountCell(reconciliation.differenceCents)],
    ...reconciliation.reasons.map((r) => [textCell(`${REASON_TEXT[r.key]} (${r.count})`), amountCell(r.cents)]),
  ];
  parts.push(table('(1fr, 32mm)', ['in €', 'Betrag'], rows));
  // „Zu korrigieren“ erklärt die Differenz nicht: ein Satz unter der Tabelle statt einer Zeile (Designer Runde 7, 264).
  if (reconciliation.toCorrect.count > 0) {
    const n = reconciliation.toCorrect.count;
    // N18: gezählt werden Bestätigungen wie in Schritt 7; die ohne Überhang nennt der Satz eigens.
    const without = reconciliation.toCorrect.withoutAmountCount;
    parts.push(paragraph(`Davon in Bestätigungen zu korrigieren: ${n} ${n === 1 ? 'Bestätigung' : 'Bestätigungen'}, ${formatEuro(reconciliation.toCorrect.cents)}${without > 0 ? `; davon ohne Auswirkung auf den Betrag: ${without}` : ''}.`));
  }
  if (reconciliation.differenceCents === 0 && reconciliation.toCorrect.count === 0) parts.push(paragraph('Zuwendungen und Bestätigungen stimmen überein.'));
  return parts.join('\n\n');
}

export const donationBookReport: ReportDefinition<DonationBookReport> = {
  key: 'donationBook',
  group: 'taxOffice',
  personal: true,
  available: true,
  orientation: 'portrait',
  paramsSchema: yearParamsSchema,
  checkParams: checkYearOrDate,
  years: (_db, params) => (params.fiscalYearId ? [params.fiscalYearId] : []),
  settingKeys: [FEES_KEY, MINIMUM_KEY],
  compute: computeDonationBookReport,
  toTypst: donationBookTypst,
  titleKey: 'finance.reports.donationBook.title',
  paperTitle: 'Spendenbuch',
  paperPeriod: (data) => `Kalenderjahr ${data.calendarYear}`,
  yearKind: 'calendar',
};
