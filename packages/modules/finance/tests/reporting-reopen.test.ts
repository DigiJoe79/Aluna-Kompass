import { schema, unwrap } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { closeInternal, previewPeriodReopen, reopenFiscalYear } from '../src/ledger/period';
import '../src/manifest';
import { withTestReports } from '../src/reporting/catalog';
import { finalizeFinanceReport, releaseReportsForFinalizing } from '../src/reporting/finalize';
import { runFinanceReport } from '../src/reporting/service';
import { releaseOfYearInternal } from '../src/reporting/stage';
import { financeFiscalYears, financeReportReleases, financeReports } from '../src/schema';
import { ledgerFixture } from './helpers';
import { testReport } from './reporting-fixture';

const multi = testReport({ key: 'testMultiTax', group: 'taxOffice', years: (_db, p) => p.fiscalYearIds ?? [], compute: () => ({ lines: 0, totalCents: 0 }), paramsSchema: z.object({ fiscalYearIds: z.array(z.string()).min(1) }) });
const REPORTS = [testReport(), testReport({ key: 'testTax', group: 'taxOffice' }), multi];

/** 2024 und 2025 abgeschlossen; 2025 freigegeben, mit einem MV-Bericht und einem Mehrjahresbericht 2024–2025 festgeschrieben. */
async function finalized() {
  const f = await ledgerFixture({ years: ['2024', '2025', '2026'] });
  const y2024 = f.years['2024']!.id;
  const y2025 = f.years['2025']!.id;
  f.closeYear(y2024);
  f.closeYear(y2025);
  unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
  const assembly = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params: { fiscalYearId: y2025 } }));
  const span = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testMultiTax', params: { fiscalYearIds: [y2024, y2025] } }));
  const only2024 = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testTax', params: { fiscalYearId: y2024 } }));
  return { f, y2024, y2025, assembly, span, only2024 };
}

describe('reopening a year voids its final reports and revokes the release (Rechenschaft A1 Task 6)', () => {
  it('describes what reopening does to reports', async () => {
    await withTestReports(REPORTS, async () => {
      const { f, y2025 } = await finalized();
      const preview = unwrap(await previewPeriodReopen(f.deps, f.ctx, { id: y2025 }));
      expect(preview.consequences).toContainEqual({ code: 'reportsVoided', params: { count: 2 } });
      expect(preview.consequences).toContainEqual({ code: 'releaseRevoked', params: {} });
    });
  });

  it('voids final reports of the year and keeps them readable', async () => {
    await withTestReports(REPORTS, async () => {
      const { f, y2025, assembly, span, only2024 } = await finalized();
      unwrap(await reopenFiscalYear(f.deps, f.ctx, { id: y2025, note: 'Nachbuchung einer Spende' }));

      for (const done of [assembly, span]) {
        const row = f.deps.db.select().from(financeReports).where(eq(financeReports.id, done.reportId)).get()!;
        expect(row.voidedAt).not.toBeNull();
        expect(row.voidReason).toBe('Nachbuchung einer Spende');
        expect(row.replacedByReportId).toBeNull();
        expect(f.deps.db.select().from(documents).where(eq(documents.id, done.documentId)).get()).toMatchObject({ status: 'voided', voidReason: 'Nachbuchung einer Spende', fileName: expect.any(String) });
      }
      // Ein Bericht nur über 2024 bleibt.
      expect(f.deps.db.select().from(financeReports).where(eq(financeReports.id, only2024.reportId)).get()!.voidedAt).toBeNull();

      expect(releaseOfYearInternal(f.deps.db, y2025)).toBeNull();
      expect(f.deps.db.select().from(financeReportReleases).where(eq(financeReportReleases.fiscalYearId, y2025)).get()!.revokedAt).not.toBeNull(); // widerrufen, nicht gelöscht
      const actions = f.deps.db.select().from(schema.auditLog).all().map((a) => a.action);
      expect(actions.filter((a) => a === 'finance.report.void')).toHaveLength(2);
      expect(actions).toContain('finance.report.releaseRevoke');
      expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params: { fiscalYearId: y2025 } })).stage).toBe('preliminary');

      const reopened = unwrap(await previewPeriodReopen(f.deps, f.ctx, { id: y2025 }));
      expect(reopened.consequences).toEqual([]);
    });
  });
});

describe('the version voided by reopening points to its successor (Plan D1d Task 4, Befund MCP 7)', () => {
  it('finalizing again sets replacedByReportId on the latest voided version with the same params', async () => {
    await withTestReports(REPORTS, async () => {
      const { f, y2025, assembly } = await finalized();
      unwrap(await reopenFiscalYear(f.deps, f.ctx, { id: y2025, note: 'Nachbuchung einer Spende' }));
      f.deps.clock.advance(60_000);
      const year = f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, y2025)).get()!;
      unwrap(f.deps.db.transaction((tx) => closeInternal(tx, f.deps, f.ctx, year)));
      unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
      const next = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params: { fiscalYearId: y2025 } }));
      const old = f.deps.db.select().from(financeReports).where(eq(financeReports.id, assembly.reportId)).get()!;
      expect(old).toMatchObject({ voidReason: 'Nachbuchung einer Spende', replacedByReportId: next.reportId });
      // Einmal gesetzt, steht der Nachfolger fest.
      expect(() => f.deps.sqlite.prepare('update finance_reports set replaced_by_report_id = ? where id = ?').run('other', assembly.reportId)).toThrow(/immutable/);
    });
  });
});
