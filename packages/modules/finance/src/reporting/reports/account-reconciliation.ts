import { isoDay, paperDate, schema, type DbOrTx } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { coveringRunInternal } from '../../import/queries';
import { countAtInternal } from '../../ledger/cash';
import { fiscalYearForInternal } from '../../ledger/fiscal-years';
import { accountBalancesAt, type AccountKind } from '../../ledger/queries';
import { financeAccounts } from '../../schema';
import type { ReportDefinition, ReportParams, ReportRenderContext } from '../types';
import { amountCell, checkYearOrDate, emptyCell, heading, paragraph, reportAccountIdsInternal, reportDateInternal, small, table, textCell, yearIdsOfDate, yearOrDateParamsSchema } from './common';

/**
 * Kontenabstimmung zum Stichtag (Spec Rechenschaft 0.4.0 § Kernberichte, Finanz-Spec § 9.3): je Konto der
 * festgeschriebene Buchbestand gegen den Kontoauszug (Bank, Zahlungsdienst), das Zählprotokoll (Kasse) oder einen
 * eingegebenen Kontostand. Sagt, womit sie rechnet; geprüfte Entwürfe stehen daneben, wo ein Konto abweicht.
 * Hochformat, Gruppe Prüfung.
 */

export interface AccountReconciliation {
  date: string;
  accounts: {
    accountId: string;
    kind: AccountKind;
    bookCents: number;
    withReviewedCents: number;
    against: { source: 'statement' | 'count' | 'enteredBalance' | 'none'; date: string | null; cents: number | null };
    state: 'matches' | 'differs' | 'noStatement' | 'noCount' | 'notReconcilable';
    differenceCents: number | null;
  }[];
}

/** Ein von Hand nachgetragener Endsaldo (`finance_import_run_set_balance`) steht als eigene Aktion im Protokoll. */
function balanceWasEntered(db: DbOrTx, runId: string): boolean {
  return !!db
    .select({ id: schema.auditLog.id })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.entityType, 'financeImportRun'), eq(schema.auditLog.entityId, runId), eq(schema.auditLog.action, 'finance.import.runBalance')))
    .get();
}

export function computeAccountReconciliation(db: DbOrTx, params: ReportParams): AccountReconciliation {
  const date = reportDateInternal(db, params);
  const book = new Map(accountBalancesAt(db, date).map((a) => [a.accountId, a.balanceCents]));
  const withReviewed = new Map(accountBalancesAt(db, date, { includeReviewedDrafts: true }).map((a) => [a.accountId, a.balanceCents]));
  // Dieselbe Kontenliste wie Kassenbericht, Vermögensübersicht und Schritt 1 (Designer Runde 7, 272).
  const rows = new Map(db.select().from(financeAccounts).all().map((a) => [a.id, a]));
  const accounts = reportAccountIdsInternal(db, { from: fiscalYearForInternal(db, date)?.startsOn ?? date, to: date })
    .map((id) => rows.get(id)!)
    .map((a): AccountReconciliation['accounts'][number] => {
      const kind = a.kind as AccountKind;
      const bookCents = book.get(a.id) ?? 0;
      const base = { accountId: a.id, kind, bookCents, withReviewedCents: withReviewed.get(a.id) ?? 0 };
      if (kind === 'cash') {
        const count = countAtInternal(db, a.id, date);
        if (!count) return { ...base, against: { source: 'none', date: null, cents: null }, state: 'noCount', differenceCents: null };
        // Verglichen wird mit dem Buchbestand am Tag der Zählung — was danach gebucht ist, hat sie nicht gesehen.
        const atCount = accountBalancesAt(db, count.countedOn).find((x) => x.accountId === a.id)?.balanceCents ?? 0;
        const differenceCents = atCount - count.countedCents;
        return { ...base, against: { source: 'count', date: count.countedOn, cents: count.countedCents }, state: differenceCents === 0 ? 'matches' : 'differs', differenceCents };
      }
      const run = coveringRunInternal(db, a.id, date);
      if (!run || run.closingCents === null) return { ...base, against: { source: 'none', date: null, cents: null }, state: kind === 'paymentService' ? 'notReconcilable' : 'noStatement', differenceCents: null };
      const differenceCents = bookCents - run.closingCents;
      return { ...base, against: { source: balanceWasEntered(db, run.id) ? 'enteredBalance' : 'statement', date: run.periodTo, cents: run.closingCents }, state: differenceCents === 0 ? 'matches' : 'differs', differenceCents };
    });
  return { date, accounts };
}

// ── Papier ─────────────────────────────────────────────────────────────────

const SOURCE: Record<AccountReconciliation['accounts'][number]['against']['source'], string> = { statement: 'Kontoauszug', count: 'Zählprotokoll', enteredBalance: 'Kontostand, eingegeben', none: '' };
const STATE: Record<AccountReconciliation['accounts'][number]['state'], string> = {
  matches: 'stimmt',
  differs: 'weicht ab',
  noStatement: 'kein Auszug zum Stichtag',
  noCount: 'keine Zählung bis zum Stichtag',
  notReconcilable: 'nicht abstimmbar',
};

export function accountReconciliationTypst(data: AccountReconciliation, ctx: ReportRenderContext): string {
  const day = (iso: string) => paperDate(isoDay(iso));
  const showReviewed = data.accounts.some((a) => a.state === 'differs');
  const columns = showReviewed ? '(1fr, 22mm, 22mm, 34mm, 22mm, 20mm)' : '(1fr, 22mm, 34mm, 22mm, 20mm)';
  const header = ['Konto', 'Buchbestand', ...(showReviewed ? ['mit geprüften Entwürfen'] : []), 'Abgeglichen mit', 'Betrag', 'Abweichung'];
  const rows = data.accounts.map((a) => [
    textCell(ctx.accountNames[a.accountId] ?? a.accountId),
    amountCell(a.bookCents),
    ...(showReviewed ? [amountCell(a.withReviewedCents)] : []),
    a.against.source === 'none' ? textCell(STATE[a.state]) : textCell(`${SOURCE[a.against.source]} ${day(a.against.date ?? data.date)}`),
    a.against.cents === null ? emptyCell : amountCell(a.against.cents),
    a.differenceCents === null ? emptyCell : a.differenceCents === 0 ? textCell(STATE.matches) : amountCell(a.differenceCents),
  ]);
  return [
    heading(2, `Konten am ${day(data.date)}, in €`),
    paragraph('Buchbestand festgeschrieben: nur festgeschriebene Buchungen bis zum Stichtag. Eine Kasse wird mit ihrer letzten Zählung bis dahin verglichen, am Tag der Zählung.'),
    table(columns, header, rows),
    ...(showReviewed ? [small('Weicht ein Konto ab, steht daneben der Bestand einschließlich geprüfter Entwürfe — oft erklärt er die Abweichung.')] : []),
  ].join('\n\n');
}

export const accountReconciliationReport: ReportDefinition<AccountReconciliation> = {
  key: 'accountReconciliation',
  group: 'audit',
  personal: false,
  available: true,
  orientation: 'portrait',
  paramsSchema: yearOrDateParamsSchema,
  checkParams: checkYearOrDate,
  years: yearIdsOfDate,
  compute: computeAccountReconciliation,
  toTypst: accountReconciliationTypst,
  titleKey: 'finance.reports.accountReconciliation.title',
  paperTitle: 'Kontenabstimmung',
};
