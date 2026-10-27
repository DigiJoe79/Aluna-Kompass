import type { DbOrTx } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ReportDefinition, ReportParams } from '../src/reporting/types';
import { financeAllocationLines, financeEntries } from '../src/schema';

/** Summe der festgeschriebenen Zuordnungszeilen eines Jahres — ein erfundener Testbericht, kein Katalogeintrag. */
const sumOfYear = (db: DbOrTx, params: ReportParams) => {
  const rows = db
    .select({ amountCents: financeAllocationLines.amountCents })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .where(and(eq(financeEntries.fiscalYearId, params.fiscalYearId ?? ''), eq(financeEntries.status, 'final')))
    .all();
  return { lines: rows.length, totalCents: rows.reduce((sum, r) => sum + r.amountCents, 0) };
};

export const testReport = (over: Partial<ReportDefinition<{ lines: number; totalCents: number }>> = {}): ReportDefinition =>
  ({
    key: 'testAssembly',
    group: 'assembly',
    personal: false,
    available: true,
    orientation: 'landscape',
    paramsSchema: z.object({ fiscalYearId: z.string().min(1) }),
    years: (_db: DbOrTx, params: ReportParams) => (params.fiscalYearId ? [params.fiscalYearId] : []),
    compute: sumOfYear,
    toTypst: (data: { lines: number; totalCents: number }) => `Zeilen: ${data.lines}, Summe: ${data.totalCents}`,
    titleKey: 'finance.reports.testAssembly.title',
    paperTitle: 'Testbericht',
    ...over,
  }) as ReportDefinition;
