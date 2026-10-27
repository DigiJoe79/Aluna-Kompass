import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { saveDraft, setReviewed } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { incomeStatement } from '../src/ledger/queries';
import { listFinanceLines } from '../src/reporting/lines';
import { ledgerFixture } from './helpers';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { financeCategories } from '../src/schema';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

/** Drei festgeschriebene Buchungen 2026: zwei Spenden (eine mit Kontakt), eine Bankgebühr; dazu ein geprüfter Entwurf. */
async function booked() {
  const f = await ledgerFixture();
  await f.finalDonation({ date: '2026-03-01', cents: 5000, contactId: f.donor.id });
  await f.finalEntry(); // 2026-03-01, 50 € Spende ohne Kontakt
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-02', text: 'Bankgebühr', moneyLines: [{ accountId: f.bank.id, amountCents: -250 }], allocationLines: [{ categoryId: f.fees.id, amountCents: -250 }] }));
  const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-05-01', text: 'Spende, geprüft', moneyLines: [{ accountId: f.bank.id, amountCents: 700 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 700 }] }));
  unwrap(await setReviewed(f.deps, f.ctx, { id: draft.id, reviewed: true }));
  return f;
}

describe('listFinanceLines (Rechenschaft A1 Task 7)', () => {
  it('lists only finalized allocation lines, and sums to the sphere total of the income statement', async () => {
    const f = await booked();
    const result = unwrap(await listFinanceLines(f.deps, f.ctx, { fiscalYearId: f.year.id, sphere: 'ideal', direction: 'income' }));
    const statement = incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    expect(result.total).toBe(2);
    expect(result.sumCents).toBe(statement.spheres.find((s) => s.sphere === 'ideal')!.incomeCents);
    expect(result.lines.map((l) => l.contactName)).toEqual(expect.arrayContaining([null, 'Musterspenderin']));
    expect(result.lines[0]).toMatchObject({ categoryId: f.donations.id, sphere: 'ideal', direction: 'income', entryDate: '2026-03-01', entryNumber: expect.any(String) });
  });

  it('filters by category, account, period, project and purpose, and counts reviewed drafts on request', async () => {
    const f = await booked();
    const year = f.year.id;
    expect(unwrap(await listFinanceLines(f.deps, f.ctx, { fiscalYearId: year, categoryId: f.fees.id })).sumCents).toBe(-250);
    expect(unwrap(await listFinanceLines(f.deps, f.ctx, { fiscalYearId: year, accountId: f.cash.id })).total).toBe(0);
    expect(unwrap(await listFinanceLines(f.deps, f.ctx, { fiscalYearId: year, accountId: f.bank.id })).total).toBe(3);
    expect(unwrap(await listFinanceLines(f.deps, f.ctx, { fiscalYearId: year, from: '2026-04-01', to: '2026-04-30' })).total).toBe(1);
    expect(unwrap(await listFinanceLines(f.deps, f.ctx, { fiscalYearId: year, projectId: 'none' })).total).toBe(0);
    expect(unwrap(await listFinanceLines(f.deps, f.ctx, { fiscalYearId: year, purposeId: f.abroadPurpose.id })).total).toBe(0);
    expect(unwrap(await listFinanceLines(f.deps, f.ctx, { fiscalYearId: year })).total).toBe(3);
    expect(unwrap(await listFinanceLines(f.deps, f.ctx, { fiscalYearId: year, includeReviewedDrafts: true })).total).toBe(4);
  });

  it('pages with a default of 50 and at most 200', async () => {
    const f = await booked();
    const page = unwrap(await listFinanceLines(f.deps, f.ctx, { fiscalYearId: f.year.id, limit: 1, offset: 1 }));
    expect(page.lines).toHaveLength(1);
    expect(page.total).toBe(3);
    expect(err(await listFinanceLines(f.deps, f.ctx, { fiscalYearId: f.year.id, limit: 201 }))).toMatchObject({ type: 'validation' });
    expect(unwrap(await listFinanceLines(f.deps, f.ctx, {})).lines.length).toBeLessThanOrEqual(50);
  });

  it('needs finance.read — the lines carry contact names', async () => {
    const f = await booked();
    expect(err(await listFinanceLines(f.deps, ctxWith(['finance.overview'], f.userId), { fiscalYearId: f.year.id }))).toEqual({ type: 'forbidden', permission: 'finance.read' });
  });

  it('filters additions to assets and received endowments (Rechenschaft D2)', async () => {
    const f = await booked();
    const cat = (key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!.id;
    const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Stiftung Beispiel' }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-06-01', text: 'Erbschaft', moneyLines: [{ accountId: f.bank.id, amountCents: 30000 }], allocationLines: [{ categoryId: cat('inheritances'), amountCents: 30000 }] }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-06-02', text: 'Ausstattung', moneyLines: [{ accountId: f.bank.id, amountCents: 20000 }], allocationLines: [{ categoryId: cat('body-grants'), amountCents: 20000, contactId: org.id, assetEndowment: true }] }));
    expect(unwrap(await listFinanceLines(f.deps, f.ctx, { fiscalYearId: f.year.id, addsToAssets: true }))).toMatchObject({ total: 2, sumCents: 50000 });
    expect(unwrap(await listFinanceLines(f.deps, f.ctx, { fiscalYearId: f.year.id, assetEndowment: true }))).toMatchObject({ total: 1, sumCents: 20000 });
  });
});
