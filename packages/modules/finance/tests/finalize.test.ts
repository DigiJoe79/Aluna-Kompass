import { newId, unwrap } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { setAccountActive, createAccount } from '../src/ledger/accounts';
import { setCategoryActive, createCategory } from '../src/ledger/categories';
import { deleteDraft, getEntry, listEntries, saveDraft, setReviewed, type EntryView } from '../src/ledger/entries';
import { bookEntry, finalizeEntry, finalizeReviewed } from '../src/ledger/finalize';
import { listFiscalYears } from '../src/ledger/fiscal-years';
import { createPurpose } from '../src/ledger/purposes';
import { financePeriodEvents } from '../src/schema';
import { allowHumanOnlyOverMcp, ledgerFixture } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

/** Ein ausgeglichener Spenden-Entwurf über Bank — Standardfall für die meisten Fälle hier. */
async function draft(f: Awaited<ReturnType<typeof ledgerFixture>>, cents: number, entryDate = '2026-03-01'): Promise<EntryView> {
  return unwrap(await saveDraft(f.deps, f.ctx, { entryDate, text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: f.donations.id, amountCents: cents }] }));
}

describe('finalizing', () => {
  it('needs finance.entriesFinalize and a person', async () => {
    const f = await ledgerFixture();
    const d = await draft(f, 5000);
    expect(err(await finalizeEntry(f.deps, ctxWith(['finance.entriesWrite', 'finance.read']), { id: d.id }))).toEqual({ type: 'forbidden', permission: 'finance.entriesFinalize' });
    const agent = { ...f.ctx, channel: 'mcp' as const };
    expect(err(await finalizeEntry(f.deps, agent, { id: d.id }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    allowHumanOnlyOverMcp(f.deps);
    expect((await finalizeEntry(f.deps, agent, { id: d.id })).ok).toBe(true);
  });

  it('numbers within the fiscal year, stamps who and how, and refuses any further change', async () => {
    const f = await ledgerFixture();
    const a = unwrap(await finalizeEntry(f.deps, f.ctx, { id: (await draft(f, 5000)).id }));
    const b = unwrap(await finalizeEntry(f.deps, f.ctx, { id: (await draft(f, 2500)).id }));
    expect([a.number, b.number]).toEqual(['2026-0001', '2026-0002']);
    expect(a).toMatchObject({ status: 'final', finalizedByUserId: f.userId, finalizedChannel: 'ui', fiscalYearId: f.year.id });
    expect(err(await saveDraft(f.deps, f.ctx, { id: a.id, entryDate: '2026-03-01', text: 'x', moneyLines: [], allocationLines: [] }))).toMatchObject({ type: 'conflict', code: 'entryNotDraft' });
    expect(err(await deleteDraft(f.deps, f.ctx, { id: a.id }))).toMatchObject({ type: 'conflict', code: 'entryNotDraft' });
  });

  it('refuses an unbalanced entry and says how much is left', async () => {
    const f = await ledgerFixture();
    const d = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Auszahlung Plattform', moneyLines: [{ accountId: f.bank.id, amountCents: 48500 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 44780 }] }));
    expect(await finalizeEntry(f.deps, f.ctx, { id: d.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'entryUnbalanced', message: expect.stringContaining('37,20 €') } });
  });

  it('refuses an empty entry, an inactive account, an inactive category', async () => {
    const f = await ledgerFixture();
    const empty = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'x', moneyLines: [], allocationLines: [] }));
    expect(err(await finalizeEntry(f.deps, f.ctx, { id: empty.id }))).toMatchObject({ type: 'conflict', code: 'entryEmpty' });

    const inactiveAccount = unwrap(await createAccount(f.deps, f.ctx, { name: 'Stilles Konto', kind: 'bank', iban: 'AT611904300234573201' }));
    unwrap(await setAccountActive(f.deps, f.ctx, { id: inactiveAccount.id, isActive: false }));
    const withInactiveAccount = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'x', moneyLines: [{ accountId: inactiveAccount.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 100 }] }));
    expect(err(await finalizeEntry(f.deps, f.ctx, { id: withInactiveAccount.id }))).toMatchObject({ type: 'conflict', code: 'accountInactive' });

    const inactiveCategory = unwrap(await createCategory(f.deps, f.ctx, { key: 'inactive-cat', name: 'Inaktiv', direction: 'income', sphere: 'ideal', incomeKind: 'other' }));
    unwrap(await setCategoryActive(f.deps, f.ctx, { id: inactiveCategory.id, isActive: false }));
    const withInactiveCategory = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 100 }], allocationLines: [{ categoryId: inactiveCategory.id, amountCents: 100 }] }));
    expect(err(await finalizeEntry(f.deps, f.ctx, { id: withInactiveCategory.id }))).toMatchObject({ type: 'conflict', code: 'categoryInactive' });
  });

  it('creates the following fiscal year with the first entry of January, and refuses a date before the first year', async () => {
    const f = await ledgerFixture();
    const jan = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2027-01-15', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 100 }] }));
    const finalized = unwrap(await finalizeEntry(f.deps, f.ctx, { id: jan.id }));
    expect(finalized.number).toBe('2027-0001');
    expect(unwrap(await listFiscalYears(f.deps, f.ctx)).map((y) => y.designation).sort()).toEqual(['2026', '2027']);

    const tooEarly = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2025-06-01', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 100 }] }));
    expect(err(await finalizeEntry(f.deps, f.ctx, { id: tooEarly.id }))).toMatchObject({ type: 'validation' });
  });

  it('refuses a closed year', async () => {
    const f = await ledgerFixture();
    f.deps.db.insert(financePeriodEvents).values({ id: newId(), fiscalYearId: f.year.id, kind: 'closed', at: '2026-06-01T00:00:00.000Z', byUserId: f.userId, reason: null }).run();
    const d = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 100 }] }));
    expect(err(await finalizeEntry(f.deps, f.ctx, { id: d.id }))).toMatchObject({ type: 'conflict', code: 'fiscalYearClosed' });
  });

  it('refuses to take a cash account below zero, naming day and amount', async () => {
    const f = await ledgerFixture();
    const res = await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Bar-Ausgabe', moneyLines: [{ accountId: f.cash.id, amountCents: -500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -500 }] });
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'cashWouldGoNegative', message: expect.stringContaining('2026-03-01') } });
  });

  it('Prüfstein 1: a transfer from the bank to the cash box has two money lines and no allocation — nothing for the income statement', async () => {
    const f = await ledgerFixture();
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Abhebung', moneyLines: [{ accountId: f.bank.id, amountCents: -20000 }, { accountId: f.cash.id, amountCents: 20000 }], allocationLines: [] }));
    expect([entry.status, entry.allocationLines.length, entry.remainderCents]).toEqual(['final', 0, 0]);
  });

  it('Prüfstein 2: a platform payout of 485 € is 500 € of donations from three donors for two purposes, less 15 € fees', async () => {
    const f = await ledgerFixture();
    const donorCtx = { ...systemContext(), permissions: new Set(['contacts.manage']) };
    const donorB = unwrap(await createContact(f.deps, donorCtx, { kind: 'person', lastName: 'Spender B' }));
    const donorC = unwrap(await createContact(f.deps, donorCtx, { kind: 'person', lastName: 'Spender C' }));
    const purpose2 = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Zweck 2' }));
    const entry = unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: '2026-03-01',
        text: 'Auszahlung Plattform',
        moneyLines: [{ accountId: f.bank.id, amountCents: 48500 }],
        allocationLines: [
          { categoryId: f.donations.id, amountCents: 20000, contactId: f.donor.id, purposeId: f.abroadPurpose.id },
          { categoryId: f.donations.id, amountCents: 20000, contactId: donorB.id, purposeId: f.abroadPurpose.id },
          { categoryId: f.donations.id, amountCents: 10000, contactId: donorC.id, purposeId: purpose2.id },
          { categoryId: f.fees.id, amountCents: -1500 },
        ],
      }),
    );
    expect([entry.status, entry.remainderCents]).toEqual(['final', 0]);
  });

  it('an in-kind donation has no money line: plus the value, minus the value', async () => {
    const f = await ledgerFixture();
    const inKind = unwrap(await createCategory(f.deps, f.ctx, { key: 'in-kind', name: 'Sachspenden', direction: 'income', sphere: 'ideal', incomeKind: 'inKindDonation' }));
    const inKindExpense = unwrap(await createCategory(f.deps, f.ctx, { key: 'in-kind-expense', name: 'Sachaufwand', direction: 'expense', sphere: 'ideal', costFunction: 'program' }));
    const entry = unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: '2026-03-01',
        text: 'Sachspende',
        moneyLines: [],
        allocationLines: [
          { categoryId: inKind.id, amountCents: 5000 },
          { categoryId: inKindExpense.id, amountCents: -5000 },
        ],
      }),
    );
    expect([entry.status, entry.moneyLines.length, entry.remainderCents]).toEqual(['final', 0, 0]);
  });

  it('bookEntry is all or nothing: a failing check leaves no draft behind', async () => {
    const f = await ledgerFixture();
    const failing = await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Bar-Ausgabe', moneyLines: [{ accountId: f.cash.id, amountCents: -500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -500 }] });
    expect(err(failing)).toMatchObject({ type: 'conflict', code: 'cashWouldGoNegative' });
    expect(unwrap(await listEntries(f.deps, f.ctx, {})).total).toBe(0);
    const next = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Einzahlung', moneyLines: [{ accountId: f.cash.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
    expect(next.number).toBe('2026-0001');
  });
});

describe('the batch run', () => {
  it('takes only reviewed drafts and finalizes all or none', async () => {
    const f = await ledgerFixture();
    const d1 = await draft(f, 1000, '2026-03-03');
    const d2 = await draft(f, 2000, '2026-03-01');
    const d3 = await draft(f, 3000, '2026-03-02');
    unwrap(await setReviewed(f.deps, f.ctx, { id: d1.id, reviewed: true }));
    unwrap(await setReviewed(f.deps, f.ctx, { id: d2.id, reviewed: true }));

    expect(err(await finalizeReviewed(f.deps, f.ctx, { ids: [d1.id, d2.id, d3.id] }))).toMatchObject({ type: 'conflict', code: 'notReviewed' });
    expect(unwrap(await getEntry(f.deps, f.ctx, { id: d1.id })).status).toBe('draft');

    unwrap(await setReviewed(f.deps, f.ctx, { id: d3.id, reviewed: true }));
    const res = unwrap(await finalizeReviewed(f.deps, f.ctx, { ids: [d1.id, d2.id, d3.id] }));
    expect(res.entries.map((e) => e.entryDate)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    expect(res.entries.map((e) => e.number)).toEqual(['2026-0001', '2026-0002', '2026-0003']);
    expect(res.sumsByAccount).toEqual([{ accountId: f.bank.id, sumCents: 6000 }]);
  });

  it('one bad entry stops the whole run and uses no number', async () => {
    const f = await ledgerFixture();
    const good = await draft(f, 1000, '2026-03-01');
    const bad = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-02', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 200 }] }));
    unwrap(await setReviewed(f.deps, f.ctx, { id: good.id, reviewed: true }));
    unwrap(await setReviewed(f.deps, f.ctx, { id: bad.id, reviewed: true }));

    expect(err(await finalizeReviewed(f.deps, f.ctx, { ids: [good.id, bad.id] }))).toMatchObject({ type: 'conflict', code: 'entryUnbalanced' });
    expect(unwrap(await getEntry(f.deps, f.ctx, { id: good.id })).status).toBe('draft');
    const numbered = unwrap(await finalizeEntry(f.deps, f.ctx, { id: good.id }));
    expect(numbered.number).toBe('2026-0001');
  });
});
