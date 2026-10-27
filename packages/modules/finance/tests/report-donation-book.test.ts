import { unwrap, writeSettingInternal } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { getDonationBook, getDonationReconciliation } from '../src/donations/book';
import { issueConfirmation } from '../src/donations/confirmations';
import { renderContextInternal } from '../src/reporting/finalize';
import { donationBookReport, donationBookTypst, type DonationBookReport } from '../src/reporting/reports/donation-book';
import { runFinanceReport } from '../src/reporting/service';
import { donationFixture } from './donation-fixture';

async function book() {
  const f = await donationFixture({ machine: true });
  await f.donate({ date: '2025-12-30', cents: 1000 });
  const money = await f.donate({ date: '2026-01-15', cents: 5000 });
  const fee = await f.donate({ date: '2026-02-01', cents: 3600, categoryKey: 'membership-fees' });
  await f.donate({ date: '2026-02-25', cents: 2000, contactId: null });
  unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [money.line.id], kind: 'money' }));
  return { f, fee, y2025: f.years['2025']!.id, y2026: f.years['2026']!.id };
}

const run = async (f: Awaited<ReturnType<typeof book>>['f'], fiscalYearId: string) => unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'donationBook', params: { fiscalYearId } })).data as DonationBookReport;

describe('Bericht donationBook (Rechenschaft B1 Task 6)', () => {
  it('holds the whole book and the reconciliation of the calendar year of the year end', async () => {
    const { f, y2026 } = await book();
    const data = await run(f, y2026);
    expect(data.calendarYear).toBe(2026);
    expect(donationBookReport.paperPeriod!(data)).toBe('Kalenderjahr 2026');
    const all = unwrap(await getDonationBook(f.deps, f.ctx, { year: 2026, limit: 500 }));
    expect(data.book.rows).toEqual(all.rows);
    expect(data.book.sums).toEqual(all.sums);
    const reconciliation = unwrap(await getDonationReconciliation(f.deps, f.ctx, { year: 2026 }));
    expect({ ...data.reconciliation, simplifiedReceiptLimitCents: null }).toEqual({ ...reconciliation, simplifiedReceiptLimitCents: null });
  });

  it('writes anonymous for a gift without contact', async () => {
    const { f, y2026 } = await book();
    const data = await run(f, y2026);
    expect(data.book.rows.find((r) => r.contactId === null)).toMatchObject({ contactName: null, amountCents: 2000 });
    expect(donationBookTypst(data, renderContextInternal(f.deps))).toContain('anonym');
  });

  it('shows the column „Zweck“ only when an entry has a purpose', async () => {
    const { f, y2026 } = await book();
    const data = await run(f, y2026);
    const ctx = renderContextInternal(f.deps);
    expect(donationBookTypst(data, ctx)).not.toContain('#"Zweck"');
    const bound = { ...data, book: { ...data.book, rows: data.book.rows.map((r, i) => (i === 0 ? { ...r, purposeName: 'Futterhilfe' } : r)) } };
    const paper = donationBookTypst(bound, ctx);
    expect(paper).toContain('#"Zweck"');
    expect(paper).toContain('Futterhilfe');
  });

  it('counts membership fees only while they are certifiable', async () => {
    const { f, fee, y2026 } = await book();
    expect((await run(f, y2026)).book.rows.map((r) => r.lineId)).toContain(fee.line.id);
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.membershipFeesCertifiable', false));
    expect((await run(f, y2026)).book.rows.map((r) => r.lineId)).not.toContain(fee.line.id);
  });
});
