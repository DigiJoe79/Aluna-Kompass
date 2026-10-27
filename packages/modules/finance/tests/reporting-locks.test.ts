import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { reopenFiscalYear } from '../src/ledger/period';
import { createTaxPeriod, saveTaxPeriodAnswers, taxPeriodInternal } from '../src/ledger/tax-periods';
import '../src/manifest';
import { finalizeFinanceReport } from '../src/reporting/finalize';
import { reportsReopenGuard } from '../src/reporting/locks';
import { listFinanceReports } from '../src/reporting/service';
import { financeReports } from '../src/schema';
import { ledgerFixture } from './helpers';

const COMPLETE = { churchPurposes: false, charitablePurposes: false, statuteDate: '2022-03-01', statuteSubmission: 'onFile', feeResolution: 'none', welfare: false, hospital: false, sport: false, gratuitousBenefits: false } as const;

/** Rechenschaft D2 Task 5, Review Focus 1: ein Bericht über einen Erklärungszeitraum findet seine Jahre über den Katalog. */
describe('Berichte über einen Erklärungszeitraum beim Wiederöffnen und auf der Seite „Berichte“', () => {
  async function finalized() {
    const f = await ledgerFixture({ years: ['2023', '2024', '2025', '2026'] });
    const y = (d: string) => f.years[d]!.id;
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2023'), lastFiscalYearId: y('2025'), withTaxAdvisor: false, dueOn: '2026-07-31' }));
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: COMPLETE }));
    for (const d of ['2023', '2024', '2025']) f.closeYear(y(d));
    const version = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: period.id } }));
    return { f, y, period, version };
  }

  it('voids the final version over 2023–2025 when 2024 is reopened, and counts it in the preview', async () => {
    const { f, y, version } = await finalized();
    expect(reportsReopenGuard.describe(f.deps.db, y('2024'))).toEqual({ code: 'reportsVoided', params: { count: 1 } });
    expect(reportsReopenGuard.describe(f.deps.db, y('2026'))).toBeNull();
    f.deps.db.transaction((tx) => reportsReopenGuard.onReopen(tx, f.deps, f.ctx, y('2024'), 'Buchung korrigiert'));
    expect(f.deps.db.select().from(financeReports).where(eq(financeReports.id, version.reportId)).get()!.voidedAt).not.toBeNull();
  });

  it('voids it through the reopening of the last year as well, and frees the years again', async () => {
    const { f, y, period, version } = await finalized();
    unwrap(await reopenFiscalYear(f.deps, f.ctx, { id: y('2025'), note: 'Nachbuchung' }));
    expect(f.deps.db.select().from(financeReports).where(eq(financeReports.id, version.reportId)).get()!.voidedAt).not.toBeNull();
    expect(taxPeriodInternal(f.deps.db, period.id)!.yearsLocked).toBe(false);
  });

  it('lists the report for every year of the period with the stage of the period, without a period no stage', async () => {
    const { f, y } = await finalized();
    const row = async (fy: string) => unwrap(await listFinanceReports(f.deps, f.ctx, { fiscalYearId: fy }));
    const in2024 = (await row(y('2024'))).reports.find((r) => r.key === 'taxReturnGem')!;
    expect(in2024).toMatchObject({ stage: 'final', group: 'taxOffice', personal: true });
    expect(in2024.lastFinal).toHaveLength(1);
    const in2026 = (await row(y('2026'))).reports.find((r) => r.key === 'taxReturnGem')!;
    expect(in2026).toMatchObject({ stage: null, lastFinal: [] });
  });
});
