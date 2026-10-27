import { newId, unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { createAccount } from '../src/ledger/accounts';
import { countAtInternal, countCash } from '../src/ledger/cash';
import { saveDraft, setReviewed } from '../src/ledger/entries';
import { setRunClosingBalance } from '../src/import/runs';
import { renderContextInternal } from '../src/reporting/finalize';
import { accountReconciliationTypst, computeAccountReconciliation } from '../src/reporting/reports/account-reconciliation';
import { runFinanceReport } from '../src/reporting/service';
import { financeImportRuns } from '../src/schema';
import { insertRun, ledgerFixture } from './helpers';

async function fixture() {
  const f = await ledgerFixture();
  await f.finalEntry(); // 2026-03-01, 50 € auf das Bankkonto
  return f;
}
const of = (data: ReturnType<typeof computeAccountReconciliation>, accountId: string) => data.accounts.find((a) => a.accountId === accountId)!;

describe('Bericht accountReconciliation (Rechenschaft A2 Task 5)', () => {
  it('compares a bank account with the statement covering the day', async () => {
    const f = await fixture();
    insertRun(f, f.bank.id, { closingCents: 5000 });
    const data = computeAccountReconciliation(f.deps.db, { fiscalYearId: f.year.id });
    expect(data.date).toBe('2026-12-31');
    expect(of(data, f.bank.id)).toMatchObject({ kind: 'bank', bookCents: 5000, against: { source: 'statement', date: '2026-12-31', cents: 5000 }, state: 'matches', differenceCents: 0 });

    const other = await fixture();
    insertRun(other, other.bank.id, { closingCents: 6000 });
    expect(of(computeAccountReconciliation(other.deps.db, { fiscalYearId: other.year.id }), other.bank.id)).toMatchObject({ state: 'differs', differenceCents: -1000 });
  });

  it('says noStatement for a bank account without one', async () => {
    const f = await fixture();
    expect(of(computeAccountReconciliation(f.deps.db, { fiscalYearId: f.year.id }), f.bank.id)).toMatchObject({ against: { source: 'none', date: null, cents: null }, state: 'noStatement', differenceCents: null });
  });

  it('compares the cash with the latest count up to the day, or says noCount', async () => {
    const f = await fixture();
    expect(of(computeAccountReconciliation(f.deps.db, { fiscalYearId: f.year.id }), f.cash.id)).toMatchObject({ against: { source: 'none' }, state: 'noCount' });
    unwrap(await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 0, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id }));
    expect(countAtInternal(f.deps.db, f.cash.id, '2026-03-09')).toBeNull();
    expect(countAtInternal(f.deps.db, f.cash.id, '2026-12-31')).toEqual({ countedOn: '2026-03-10', countedCents: 0 });
    expect(of(computeAccountReconciliation(f.deps.db, { fiscalYearId: f.year.id }), f.cash.id)).toMatchObject({ against: { source: 'count', date: '2026-03-10', cents: 0 }, state: 'matches', differenceCents: 0 });
    expect(of(computeAccountReconciliation(f.deps.db, { date: '2026-03-09' }), f.cash.id)).toMatchObject({ state: 'noCount' });
  });

  it('says notReconcilable for a payment service without balance, and knows an entered one', async () => {
    const f = await fixture();
    const service = unwrap(await createAccount(f.deps, f.ctx, { name: 'Zahlungsdienst', kind: 'paymentService', openingBalanceCents: 0, openingDate: '2026-01-01' }));
    expect(of(computeAccountReconciliation(f.deps.db, { fiscalYearId: f.year.id }), service.id)).toMatchObject({ against: { source: 'none' }, state: 'notReconcilable', differenceCents: null });

    const runId = newId();
    f.deps.db
      .insert(financeImportRuns)
      .values({ id: runId, accountId: service.id, format: 'csv', fileName: 'umsaetze.csv', fileSha256: runId.padEnd(64, '0'), fileKey: null, periodFrom: '2026-01-01', periodTo: '2026-12-31', closingCents: null, startedAt: '2026-03-01T09:00:00.000Z', finishedAt: '2026-03-01T09:01:00.000Z', createdByUserId: f.userId, createdChannel: 'ui' })
      .run();
    unwrap(await setRunClosingBalance(f.deps, f.ctx, { runId, closingBalanceCents: 0 }));
    expect(of(computeAccountReconciliation(f.deps.db, { fiscalYearId: f.year.id }), service.id)).toMatchObject({ against: { source: 'enteredBalance', cents: 0 }, state: 'matches' });
  });

  it('adds reviewed drafts beside the finalized balance', async () => {
    const f = await fixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-05-01', text: 'Spende, geprüft', moneyLines: [{ accountId: f.bank.id, amountCents: 700 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 700 }] }));
    unwrap(await setReviewed(f.deps, f.ctx, { id: draft.id, reviewed: true }));
    expect(of(computeAccountReconciliation(f.deps.db, { fiscalYearId: f.year.id }), f.bank.id)).toMatchObject({ bookCents: 5000, withReviewedCents: 5700 });
  });

  it('says what it compares, and names the reviewed drafts only when an account differs', async () => {
    const f = await fixture();
    insertRun(f, f.bank.id, { closingCents: 5000 });
    const matching = accountReconciliationTypst(computeAccountReconciliation(f.deps.db, { fiscalYearId: f.year.id }), renderContextInternal(f.deps));
    expect(matching).toContain('Buchbestand festgeschrieben');
    expect(matching).not.toContain('einschließlich geprüfter Entwürfe');
    const other = await fixture();
    insertRun(other, other.bank.id, { closingCents: 6000 });
    expect(accountReconciliationTypst(computeAccountReconciliation(other.deps.db, { fiscalYearId: other.year.id }), renderContextInternal(other.deps))).toContain('einschließlich geprüfter Entwürfe');
    const run = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'accountReconciliation', params: { date: '2026-06-30' } }));
    expect(run.data).toMatchObject({ date: '2026-06-30' });
  });
});
