import { accountReconciliationReport } from './reports/account-reconciliation';
import { annualAccountsReport } from './reports/annual-accounts';
import { assetOverviewReport } from './reports/asset-overview';
import { cashReportDefinition } from './reports/cash-report';
import { donationBookReport } from './reports/donation-book';
import { fundsUseReport } from './reports/funds-use';
import { foreignActivityReportDefinition } from './reports/foreign-activity';
import { handoverListReport } from './reports/handover-list';
import { incomeStatementReport } from './reports/income-statement';
import { monthlyOverviewReport } from './reports/monthly-overview';
import { peopleOverviewReport } from './reports/people-overview';
import { projectStatementReport } from './reports/project-statement';
import { purposeFundsReport } from './reports/purpose-funds';
import { reserveStatementReport } from './reports/reserve-statement';
import { taxReturnGemReport } from './reports/tax-return-gem';
import { taxReturnIncomeStatementReport } from './reports/tax-return-income-statement';
import { vatAdvanceReturnReport } from './reports/vat-advance-return';
import { vatSummaryReport } from './reports/vat-summary';
import { voucherCheckReport } from './reports/voucher-check';
import type { ReportDefinition } from './types';

/** Der Katalog (Spec § A „Mechanik“). Statisch; A2 trägt die Kernberichte ein, B1 die übrigen. */
const catalog: ReportDefinition[] = [incomeStatementReport as ReportDefinition, assetOverviewReport as ReportDefinition, cashReportDefinition as ReportDefinition, accountReconciliationReport as ReportDefinition, purposeFundsReport as ReportDefinition, projectStatementReport as ReportDefinition, reserveStatementReport as ReportDefinition, foreignActivityReportDefinition as ReportDefinition, donationBookReport as ReportDefinition, peopleOverviewReport as ReportDefinition, voucherCheckReport as ReportDefinition, vatSummaryReport as ReportDefinition, vatAdvanceReturnReport as ReportDefinition, handoverListReport as ReportDefinition, monthlyOverviewReport as ReportDefinition, taxReturnGemReport as ReportDefinition, taxReturnIncomeStatementReport as ReportDefinition, annualAccountsReport as ReportDefinition, fundsUseReport as ReportDefinition];

export const REPORT_CATALOG: readonly ReportDefinition[] = catalog;

export function reportDefinition(key: string): ReportDefinition | null {
  return catalog.find((d) => d.key === key) ?? null;
}

/**
 * Nur für Tests: hängt Definitionen für die Dauer von `fn` an den Katalog (wie die eingereichten Wächter in
 * `period.test.ts`) und nimmt sie danach wieder heraus, auch wenn `fn` wirft.
 */
export async function withTestReports<T>(defs: readonly ReportDefinition[], fn: () => Promise<T> | T): Promise<T> {
  catalog.push(...defs);
  try {
    return await fn();
  } finally {
    for (const def of defs) {
      const at = catalog.indexOf(def);
      if (at >= 0) catalog.splice(at, 1);
    }
  }
}
