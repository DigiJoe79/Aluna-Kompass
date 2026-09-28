import { newId, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { previewBatchFinalize } from '../src/import/batch';
import { bookFromTransaction } from '../src/import/book';
import { createAccount, setAccountActive } from '../src/ledger/accounts';
import { getEntry, saveDraft, setReviewed } from '../src/ledger/entries';
import { bookEntry, finalizeReviewed } from '../src/ledger/finalize';
import { financeEntries, financeMoneyLines } from '../src/schema';
import { insertRaw, insertRun, ledgerFixture } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

async function reviewedDraft(f: Fixture, accountId: string, cents: number, date = '2026-03-05') {
  const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: date, text: 'Entwurf', moneyLines: [{ accountId, amountCents: cents }], allocationLines: [{ categoryId: cents > 0 ? f.donations.id : f.fees.id, amountCents: cents }] }));
  return unwrap(await setReviewed(f.deps, f.ctx, { id: draft.id, reviewed: true }));
}

describe('previewBatchFinalize', () => {
  it('zeigt keine Abgleichzeile gegen einen Auszug, der vor den zu schreibenden Entwürfen endet (Befund 44)', async () => {
    const f = await ledgerFixture();
    // Der leere Vorjahresauszug aus dem Seed: endet am 31.12., die Entwürfe liegen im neuen Jahr.
    insertRun(f, f.bank.id, { closingCents: 0, periodTo: '2025-12-31' });
    await reviewedDraft(f, f.bank.id, 1200, '2026-03-05');
    const preview = unwrap(await previewBatchFinalize(f.deps, f.ctx, {}));
    expect(preview.byAccount).toMatchObject([{ accountId: f.bank.id, sumCents: 1200, statementClosingCents: null, statementDate: null, matches: null }]);

    // Reicht der Auszug in den Zeitraum der Entwürfe, steht die Zeile wieder da.
    insertRun(f, f.bank.id, { closingCents: 1200, periodTo: '2026-03-31' });
    expect(unwrap(await previewBatchFinalize(f.deps, f.ctx, {})).byAccount).toMatchObject([{ statementClosingCents: 1200, statementDate: '2026-03-31', matches: true }]);
  });

  it('previews sums per account, the book balance after, and the statement closing with a match flag', async () => {
    const f = await ledgerFixture();
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] }));
    const run = insertRun(f, f.bank.id, { closingCents: 7500, periodTo: '2026-03-31' });
    insertRun(f, f.bank.id, { closingCents: 99999, periodTo: '2026-04-30', discarded: true }); // verworfen: zählt nicht
    const rawIn = insertRaw(f, run, { accountId: f.bank.id, amountCents: 3000 });
    const rawOut = insertRaw(f, run, { accountId: f.bank.id, amountCents: -500 });
    const a = unwrap(await bookFromTransaction(f.deps, f.ctx, { rawTransactionId: rawIn, text: 'Spende', allocationLines: [{ categoryId: f.donations.id, amountCents: 3000 }], reviewed: true }));
    const b = unwrap(await bookFromTransaction(f.deps, f.ctx, { rawTransactionId: rawOut, text: 'Gebühr', allocationLines: [{ categoryId: f.fees.id, amountCents: -500 }], reviewed: true }));
    // Ein ungeprüfter Entwurf gehört nicht dazu.
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Offen', moneyLines: [{ accountId: f.bank.id, amountCents: 100 }], allocationLines: [] }));

    const preview = unwrap(await previewBatchFinalize(f.deps, f.ctx, {}));
    expect(preview).toEqual({
      entries: 2,
      numbersToBeAssigned: 2,
      problems: [],
      byAccount: [{ accountId: f.bank.id, accountName: 'Vereinskonto', kind: 'bank', sumCents: 2500, bookCentsNow: 5000, bookCentsAfter: 7500, statementClosingCents: 7500, statementDate: '2026-03-31', matches: true, negative: false }],
    });

    // Mit ids nur diese; ohne die Gebühr stimmt der Endsaldo nicht.
    const onlyA = unwrap(await previewBatchFinalize(f.deps, f.ctx, { ids: [a.id] }));
    expect(onlyA.byAccount).toMatchObject([{ sumCents: 3000, bookCentsAfter: 8000, matches: false }]);
    void b;

    // Lesen genügt; ein Entwurf, der nicht geprüft ist, wird genannt wie beim Festschreiben.
    expect(await previewBatchFinalize(f.deps, ctxWith(['finance.overview']), {})).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.read' } });
    expect(await previewBatchFinalize(f.deps, f.ctx, { ids: [] })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await previewBatchFinalize(f.deps, f.ctx, { ids: ['nope'] })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });

  it('refuses when there is nothing reviewed', async () => {
    const f = await ledgerFixture();
    expect(await previewBatchFinalize(f.deps, f.ctx, {})).toMatchObject({ ok: false, error: { type: 'conflict', code: 'batchNothingReviewed' } });
  });

  it('previews and refuses the batch as a whole when one reviewed draft cannot be finalized', async () => {
    const f = await ledgerFixture();
    const savings = unwrap(await createAccount(f.deps, f.ctx, { name: 'Rücklagenkonto', kind: 'bank', iban: 'DE75999999990000303062' }));
    const good = await reviewedDraft(f, f.bank.id, 3000);
    const bad = await reviewedDraft(f, savings.id, 2000);
    unwrap(await setAccountActive(f.deps, f.ctx, { id: savings.id, isActive: false }));

    const preview = unwrap(await previewBatchFinalize(f.deps, f.ctx, {}));
    expect(preview.problems).toEqual([{ entryId: bad.id, code: 'accountInactive' }]);
    expect(preview.entries).toBe(2);
    // Die Vorschau schreibt nichts.
    expect(f.deps.db.select().from(financeEntries).where(eq(financeEntries.status, 'final')).all()).toHaveLength(0);

    // Alle oder keiner — der Sammellauf lehnt als Ganzes ab.
    expect(await finalizeReviewed(f.deps, f.ctx, { ids: [good.id, bad.id] })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'accountInactive' } });
    expect(unwrap(await getEntry(f.deps, f.ctx, { id: good.id })).status).toBe('draft');
  });

  it('names an unbalanced draft and a closed year among the problems', async () => {
    const f = await ledgerFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Halb', moneyLines: [{ accountId: f.bank.id, amountCents: 3000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
    unwrap(await setReviewed(f.deps, f.ctx, { id: draft.id, reviewed: true }));
    expect(unwrap(await previewBatchFinalize(f.deps, f.ctx, {})).problems).toEqual([{ entryId: draft.id, code: 'entryUnbalanced' }]);

    const g = await ledgerFixture();
    const late = await reviewedDraft(g, g.bank.id, 3000);
    g.closeYear(g.year.id);
    expect(unwrap(await previewBatchFinalize(g.deps, g.ctx, {})).problems).toEqual([{ entryId: late.id, code: 'fiscalYearClosed' }]);
  });

  it('says a cash account has no statement instead of comparing', async () => {
    const f = await ledgerFixture();
    // Ein geprüfter Entwurf mit Kassenzeile entsteht über saveDraft nicht mehr (Bargeld bucht in einem Zug) —
    // hier von Hand eingefügt, wie ihn ältere Daten tragen könnten.
    const draft = await reviewedDraft(f, f.bank.id, 3000);
    f.deps.db.insert(financeMoneyLines).values({ id: newId(), entryId: draft.id, position: 1, accountId: f.cash.id, amountCents: -3000, rawTransactionId: null, rawReleasedAt: null }).run();
    const cashRow = unwrap(await previewBatchFinalize(f.deps, f.ctx, {})).byAccount.find((a) => a.accountId === f.cash.id);
    expect(cashRow).toEqual({ accountId: f.cash.id, accountName: 'Barkasse', kind: 'cash', sumCents: -3000, bookCentsNow: 0, bookCentsAfter: -3000, statementClosingCents: null, statementDate: null, matches: null, negative: false });
    // Ein Bankkonto ohne jeden Auszug vergleicht ebenfalls nicht.
    expect(unwrap(await previewBatchFinalize(f.deps, f.ctx, {})).byAccount.find((a) => a.accountId === f.bank.id)).toMatchObject({ statementClosingCents: null, statementDate: null, matches: null });
  });

  it('warns in the finalize preview when a bank or payment-service account would go negative (Befund 19)', async () => {
    const f = await ledgerFixture();
    const paypal = unwrap(await createAccount(f.deps, f.ctx, { name: 'PayPal', kind: 'paymentService' }));
    const bankOut = await reviewedDraft(f, f.bank.id, -6000);
    const paypalOut = await reviewedDraft(f, paypal.id, -100);

    const preview = unwrap(await previewBatchFinalize(f.deps, f.ctx, { ids: [bankOut.id, paypalOut.id] }));
    expect(preview.byAccount.find((a) => a.accountId === f.bank.id)).toMatchObject({ bookCentsAfter: -6000, negative: true });
    expect(preview.byAccount.find((a) => a.accountId === paypal.id)).toMatchObject({ bookCentsAfter: -100, negative: true });

    // Die Kasse bleibt bei der bestehenden Sperre (Entwurf auf einem Barkonto lässt sich nicht parken) — sie kennt `negative` nie als true.
    const cashRow = unwrap(await previewBatchFinalize(f.deps, f.ctx, {})).byAccount.find((a) => a.kind === 'cash');
    if (cashRow) expect(cashRow.negative).toBe(false);
  });

  it('batch finalize skips future-dated entries and names them (Befund 20)', async () => {
    const f = await ledgerFixture();
    const future = await reviewedDraft(f, f.bank.id, 3000, '2026-09-06');
    expect(future.warnings).toEqual(['futureDate']);
    const preview = unwrap(await previewBatchFinalize(f.deps, f.ctx, {}));
    expect(preview.problems).toEqual([{ entryId: future.id, code: 'entryDateInFuture' }]);

    // Alle oder keiner — der Sammellauf lehnt als Ganzes ab, statt den Entwurf zu übergehen.
    expect(await finalizeReviewed(f.deps, f.ctx, { ids: [future.id] })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'entryDateInFuture' } });
    expect(unwrap(await getEntry(f.deps, f.ctx, { id: future.id })).status).toBe('draft');
  });
});
