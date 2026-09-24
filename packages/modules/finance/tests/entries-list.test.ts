import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { listEntries, saveDraft, setReviewed } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { reverseEntry } from '../src/ledger/reverse';
import { uploadVoucher } from '../src/ledger/vouchers';
import { financeCategories } from '../src/schema';
import { ledgerFixture, pdfBytes } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

describe('listEntries: filters, sorting and totals over the filtered set', () => {
  it('filters by the four state words', async () => {
    const f = await ledgerFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Entwurf', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
    const reviewedDraft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-02', text: 'Geprueft', moneyLines: [{ accountId: f.bank.id, amountCents: 2000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2000 }] }));
    unwrap(await setReviewed(f.deps, f.ctx, { id: reviewedDraft.id, reviewed: true, expectedVersion: reviewedDraft.updatedAt }));
    const final = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-03', text: 'Fest', moneyLines: [{ accountId: f.bank.id, amountCents: 3000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 3000 }] }));
    const toReverse = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-04', text: 'Zurueckgenommen', moneyLines: [{ accountId: f.bank.id, amountCents: 4000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 4000 }] }));
    const { reversal } = unwrap(await reverseEntry(f.deps, f.ctx, { id: toReverse.id }));

    expect(unwrap(await listEntries(f.deps, f.ctx, { state: 'draft' })).entries.map((e) => e.id)).toEqual([draft.id]);
    expect(unwrap(await listEntries(f.deps, f.ctx, { state: 'reviewed' })).entries.map((e) => e.id)).toEqual([reviewedDraft.id]);
    // Die Gegenbuchung ist 'final', nicht 'reversed'.
    expect(unwrap(await listEntries(f.deps, f.ctx, { state: 'final' })).entries.map((e) => e.id).sort()).toEqual([final.id, reversal.id].sort());
    expect(unwrap(await listEntries(f.deps, f.ctx, { state: 'reversed' })).entries.map((e) => e.id)).toEqual([toReverse.id]);
  });

  it('filters by a list of ids — the link from a rule preview to the entries booked differently', async () => {
    const f = await ledgerFixture();
    const a = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'A', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-02', text: 'B', moneyLines: [{ accountId: f.bank.id, amountCents: 2000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2000 }] }));
    const c = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-03', text: 'C', moneyLines: [{ accountId: f.bank.id, amountCents: 3000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 3000 }] }));
    expect(unwrap(await listEntries(f.deps, f.ctx, { ids: [a.id, c.id] })).entries.map((e) => e.id).sort()).toEqual([a.id, c.id].sort());
    expect(unwrap(await listEntries(f.deps, f.ctx, { ids: ['unknown'] })).total).toBe(0);
    expect(err(await listEntries(f.deps, f.ctx, { ids: [] }))).toMatchObject({ type: 'validation' });
  });

  it('filters by category across split lines', async () => {
    const f = await ledgerFixture();
    const split = unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: '2026-03-01', text: 'Split',
        moneyLines: [{ accountId: f.bank.id, amountCents: 3000 }],
        allocationLines: [{ categoryId: f.donations.id, amountCents: 2000 }, { categoryId: f.purposeIncome.id, amountCents: 1000 }],
      }),
    );
    const other = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-02', text: 'Andere', moneyLines: [{ accountId: f.bank.id, amountCents: 500 }], allocationLines: [{ categoryId: f.fees.id, amountCents: 500 }] }));

    const byPurposeIncome = unwrap(await listEntries(f.deps, f.ctx, { categoryId: f.purposeIncome.id }));
    expect(byPurposeIncome.entries.map((e) => e.id)).toEqual([split.id]);
    const byFees = unwrap(await listEntries(f.deps, f.ctx, { categoryId: f.fees.id }));
    expect(byFees.entries.map((e) => e.id)).toEqual([other.id]);
  });

  it('finds by part of the text, by number and by amount in German format', async () => {
    const f = await ledgerFixture();
    const flyer = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Flyer-Druck', moneyLines: [{ accountId: f.bank.id, amountCents: -6000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -6000 }] }));
    const other = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-02', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 1250 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1250 }] }));

    expect(unwrap(await listEntries(f.deps, f.ctx, { text: 'flyer' })).entries.map((e) => e.id)).toEqual([flyer.id]);
    expect(unwrap(await listEntries(f.deps, f.ctx, { text: other.number! })).entries.map((e) => e.id)).toEqual([other.id]);
    expect(unwrap(await listEntries(f.deps, f.ctx, { text: '12,50' })).entries.map((e) => e.id)).toEqual([other.id]);
  });

  it('lists only entries without voucher when asked', async () => {
    const f = await ledgerFixture();
    const withVoucher = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Mit Beleg', moneyLines: [{ accountId: f.bank.id, amountCents: -1500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500 }] }));
    unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: withVoucher.id, bytes: pdfBytes(), typeKey: 'voucher-own', documentDate: '2026-03-01' }));
    const withoutVoucher = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-02', text: 'Ohne Beleg', moneyLines: [{ accountId: f.bank.id, amountCents: -1200 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1200 }] }));

    const result = unwrap(await listEntries(f.deps, f.ctx, { withoutVoucher: true }));
    expect(result.entries.map((e) => e.id)).toEqual([withoutVoucher.id]);
  });

  it('lists only entries an agent prepared', async () => {
    const f = await ledgerFixture();
    const agentDraft = unwrap(await saveDraft(f.deps, { ...f.ctx, channel: 'mcp' }, { entryDate: '2026-03-01', text: 'Von einem Agenten', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
    const humanDraft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-02', text: 'Von Hand', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));

    const result = unwrap(await listEntries(f.deps, f.ctx, { agentPrepared: true }));
    expect(result.entries.map((e) => e.id)).toEqual([agentDraft.id]);
    expect(result.entries.map((e) => e.id)).not.toContain(humanDraft.id);
  });

  it('sorts by date, number, text and amount in both directions; drafts without number sort last by number', async () => {
    const f = await ledgerFixture();
    const a = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-03', text: 'B-Eintrag', moneyLines: [{ accountId: f.bank.id, amountCents: 3000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 3000 }] }));
    const b = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'A-Eintrag', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-02', text: 'C-Entwurf', moneyLines: [{ accountId: f.bank.id, amountCents: 2000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2000 }] }));

    const byDateAsc = unwrap(await listEntries(f.deps, f.ctx, { orderBy: { field: 'entryDate', direction: 'asc' } }));
    expect(byDateAsc.entries.map((e) => e.id)).toEqual([b.id, draft.id, a.id]);
    const byDateDesc = unwrap(await listEntries(f.deps, f.ctx, { orderBy: { field: 'entryDate', direction: 'desc' } }));
    expect(byDateDesc.entries.map((e) => e.id)).toEqual([a.id, draft.id, b.id]);

    const byTextAsc = unwrap(await listEntries(f.deps, f.ctx, { orderBy: { field: 'text', direction: 'asc' } }));
    expect(byTextAsc.entries.map((e) => e.id)).toEqual([b.id, a.id, draft.id]);

    const byAmountAsc = unwrap(await listEntries(f.deps, f.ctx, { orderBy: { field: 'amount', direction: 'asc' } }));
    expect(byAmountAsc.entries.map((e) => e.id)).toEqual([b.id, draft.id, a.id]);

    // Nummern folgen der Reihenfolge des Festschreibens (a zuerst, dann b), nicht dem Buchungsdatum;
    // der Entwurf hat keine Nummer und muss trotz 'asc' zuletzt stehen.
    const byNumberAsc = unwrap(await listEntries(f.deps, f.ctx, { orderBy: { field: 'number', direction: 'asc' } }));
    expect(byNumberAsc.entries.map((e) => e.id)).toEqual([a.id, b.id, draft.id]);
    const byNumberDesc = unwrap(await listEntries(f.deps, f.ctx, { orderBy: { field: 'number', direction: 'desc' } }));
    expect(byNumberDesc.entries.map((e) => e.id)).toEqual([b.id, a.id, draft.id]);
  });

  it('sums income, expenses and result over the whole filtered set, not the page', async () => {
    const f = await ledgerFixture();
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende 1', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-02', text: 'Spende 2', moneyLines: [{ accountId: f.bank.id, amountCents: 3000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 3000 }] }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-03', text: 'Ausgabe', moneyLines: [{ accountId: f.bank.id, amountCents: -2000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -2000 }] }));

    const result = unwrap(await listEntries(f.deps, f.ctx, { limit: 1 }));
    expect(result.total).toBe(3);
    expect(result.entries).toHaveLength(1);
    expect(result.totals).toEqual({ incomeCents: 8000, expenseCents: 2000, resultCents: 6000 });
  });

  it('lets a negative line in an income category reduce income, and ignores transfers', async () => {
    const f = await ledgerFixture();
    // Auszahlung einer Spendenplattform: Einnahme abzueglich Gebuehr in derselben Einnahmekategorie.
    unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: '2026-03-01', text: 'Auszahlung Plattform',
        moneyLines: [{ accountId: f.bank.id, amountCents: 4500 }],
        allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }, { categoryId: f.donations.id, amountCents: -500 }],
      }),
    );
    const notOurs = f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'not-ours')).get()!;
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-02', text: 'Umbuchung', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: notOurs.id, amountCents: 1000 }] }));

    const result = unwrap(await listEntries(f.deps, f.ctx, {}));
    expect(result.totals).toEqual({ incomeCents: 4500, expenseCents: 0, resultCents: 4500 });
  });

  it('keeps the old status filter working', async () => {
    const f = await ledgerFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Entwurf', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
    const final = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-02', text: 'Fest', moneyLines: [{ accountId: f.bank.id, amountCents: 2000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2000 }] }));

    expect(unwrap(await listEntries(f.deps, f.ctx, { status: 'draft' })).entries.map((e) => e.id)).toEqual([draft.id]);
    expect(unwrap(await listEntries(f.deps, f.ctx, { status: 'final' })).entries.map((e) => e.id)).toEqual([final.id]);
  });

  it('refuses without finance.read', async () => {
    const f = await ledgerFixture();
    expect(err(await listEntries(f.deps, ctxWith([]), {}))).toEqual({ type: 'forbidden', permission: 'finance.read' });
  });
});
