import { schema, unwrap } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount } from '../src/ledger/accounts';
import { setDatedValue } from '../src/ledger/dated-values';
import { deleteDraft, getEntry, listEntries, saveDraft, setReviewed } from '../src/ledger/entries';
import { finalizeEntry } from '../src/ledger/finalize';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { installFinance } from '../src/install';
import { financeCategories } from '../src/schema';
import { allowHumanOnlyOverMcp, ledgerFixture, setupFinance } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

describe('drafts', () => {
  it('needs finance.entriesWrite to write and finance.read to read — overview is not enough', async () => {
    const f = await ledgerFixture();
    const input = { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] };
    expect(err(await saveDraft(f.deps, ctxWith(['finance.read']), input))).toEqual({ type: 'forbidden', permission: 'finance.entriesWrite' });
    const draft = unwrap(await saveDraft(f.deps, f.ctx, input));
    expect(err(await getEntry(f.deps, ctxWith(['finance.overview']), { id: draft.id }))).toEqual({ type: 'forbidden', permission: 'finance.read' });
    expect(err(await listEntries(f.deps, ctxWith(['finance.overview']), {}))).toEqual({ type: 'forbidden', permission: 'finance.read' });
  });

  it('may be unbalanced and says how much is left to allocate', async () => {
    const f = await ledgerFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Auszahlung Plattform', moneyLines: [{ accountId: f.bank.id, amountCents: 48500 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 44780 }] }));
    expect(draft).toMatchObject({ status: 'draft', number: null, remainderCents: 3720, createdChannel: 'ui' });
  });

  it('fills defaults from the category and the purpose', async () => {
    const f = await ledgerFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'x', moneyLines: [], allocationLines: [{ categoryId: f.donations.id, amountCents: 100, purposeId: f.abroadPurpose.id }] }));
    expect(draft.allocationLines[0]).toMatchObject({ taxCode: 'none', rateKind: 'standard', abroad: true, addsToAssets: false });
  });

  it('checks that what it points at exists', async () => {
    const f = await ledgerFixture();
    const line = { categoryId: f.donations.id, amountCents: 100 };
    const base = { entryDate: '2026-03-01', text: 'x', moneyLines: [] };
    expect(err(await saveDraft(f.deps, f.ctx, { ...base, allocationLines: [{ ...line, categoryId: 'nope' }] }))).toMatchObject({ type: 'notFound', entity: 'financeCategory' });
    expect(err(await saveDraft(f.deps, f.ctx, { ...base, allocationLines: [{ ...line, contactId: 'nope' }] }))).toMatchObject({ type: 'notFound', entity: 'contact' });
    expect(err(await saveDraft(f.deps, f.ctx, { ...base, allocationLines: [{ ...line, projectId: 'nope' }] }))).toMatchObject({ type: 'notFound', entity: 'project' });
    expect(err(await saveDraft(f.deps, f.ctx, { ...base, moneyLines: [{ accountId: 'nope', amountCents: 1 }], allocationLines: [] }))).toMatchObject({ type: 'notFound', entity: 'financeAccount' });
    expect(err(await saveDraft(f.deps, f.ctx, { ...base, allocationLines: [{ ...line, amountCents: 0 }] }))).toMatchObject({ type: 'validation' });
  });

  it('cannot park cash', async () => {
    const f = await ledgerFixture();
    expect(err(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Dose', moneyLines: [{ accountId: f.cash.id, amountCents: 1000 }], allocationLines: [] }))).toMatchObject({ type: 'conflict', code: 'cashDraftNotAllowed' });
  });

  it('replaces the lines as a whole, refuses a stale version, and lists with filters', async () => {
    const f = await ledgerFixture();
    const first = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'A', moneyLines: [{ accountId: f.bank.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 100 }] }));
    expect(err(await saveDraft(f.deps, f.ctx, { id: first.id, expectedVersion: '2000-01-01T00:00:00.000Z', entryDate: '2026-03-01', text: 'B', moneyLines: [], allocationLines: [] }))).toMatchObject({ type: 'conflict', code: 'staleVersion' });
    const second = unwrap(await saveDraft(f.deps, f.ctx, { id: first.id, expectedVersion: first.updatedAt, entryDate: '2026-03-02', text: 'B', moneyLines: [], allocationLines: [{ categoryId: f.fees.id, amountCents: -250 }] }));
    expect([second.moneyLines.length, second.allocationLines.length, second.remainderCents]).toEqual([0, 1, 250]);
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-05-01', text: 'C', moneyLines: [{ accountId: f.bank.id, amountCents: 1 }], allocationLines: [] }));
    expect(unwrap(await listEntries(f.deps, f.ctx, {})).total).toBe(2);
    expect(unwrap(await listEntries(f.deps, f.ctx, { from: '2026-04-01' })).entries.map((e) => e.text)).toEqual(['C']);
    expect(unwrap(await listEntries(f.deps, f.ctx, { accountId: f.bank.id })).total).toBe(1);
  });

  it('deletes a draft, and logs neither text nor contact', async () => {
    const f = await ledgerFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende von Erika Beispiel', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000, contactId: f.donor.id }] }));
    unwrap(await deleteDraft(f.deps, f.ctx, { id: draft.id }));
    const log = JSON.stringify(f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action.startsWith('finance.entry.')));
    expect(log).toContain('finance.entry.draftDelete');
    expect(log).not.toContain('Erika');
    expect(log).not.toContain(f.donor.id);
  });

  it('refuses a draft dated outside every fiscal year and before the first, but creates the immediate next year', async () => {
    const f = await ledgerFixture(); // Geschäftsjahr 2026-01-01..2026-12-31
    expect(err(await saveDraft(f.deps, f.ctx, { entryDate: '2025-06-01', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 100 }] }))).toMatchObject({
      type: 'conflict',
      code: 'noFiscalYearForDate',
      message: expect.stringContaining('2025-06-01'),
    });

    const nextYear = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2027-02-01', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 100 }] }));
    expect(nextYear.status).toBe('draft');
    expect(unwrap(await listEntries(f.deps, f.ctx, {})).entries.map((e) => e.id)).toContain(nextYear.id);

    // Ein Tippfehler in einem fernen Jahr legt weiterhin nicht vierzig Jahre an.
    expect(err(await saveDraft(f.deps, f.ctx, { entryDate: '2062-01-01', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 100 }] }))).toMatchObject({
      type: 'conflict',
      code: 'noFiscalYearForDate',
    });
  });
});

describe('numbering in a short fiscal year (Befund 15, Weg 2)', () => {
  it('numbers entries 2026-0001, not "2026 (Rumpfjahr)-0001"', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    const bank = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
    const donations = deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'donations')).get()!;
    unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-03-15', endsOn: '2026-12-31' }));
    const d = unwrap(await saveDraft(deps, ctx, { entryDate: '2026-06-01', text: 'Spende', moneyLines: [{ accountId: bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: donations.id, amountCents: 5000 }] }));
    const finalized = unwrap(await finalizeEntry(deps, ctx, { id: d.id }));
    expect(finalized.number).toBe('2026-0001');
  });
});

describe('reviewed', () => {
  const draftInput = (f: Awaited<ReturnType<typeof ledgerFixture>>) => ({ entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] });

  it('is set by a person with their name and time, and cleared by any change to the draft', async () => {
    const f = await ledgerFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, draftInput(f)));
    const reviewed = unwrap(await setReviewed(f.deps, f.ctx, { id: draft.id, reviewed: true }));
    expect(reviewed).toMatchObject({ reviewedByUserId: f.userId });
    expect(reviewed.reviewedAt).not.toBeNull();
    const changed = unwrap(await saveDraft(f.deps, f.ctx, { ...draftInput(f), id: draft.id, text: 'Spende, korrigiert' }));
    expect([changed.reviewedAt, changed.reviewedByUserId]).toEqual([null, null]);
  });

  it('an agent prepares, a person reviews: over MCP it is refused until the association allows it at the screen', async () => {
    const f = await ledgerFixture();
    const agent = { ...f.ctx, channel: 'mcp' as const };
    const draft = unwrap(await saveDraft(f.deps, agent, draftInput(f)));
    expect(draft.createdChannel).toBe('mcp');
    expect(err(await setReviewed(f.deps, agent, { id: draft.id, reviewed: true }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    allowHumanOnlyOverMcp(f.deps);
    expect((await setReviewed(f.deps, agent, { id: draft.id, reviewed: true })).ok).toBe(true);
  });
});

describe('tax on the entry', () => {
  it('shows the tax of each line by the rules of the entry date — the taxation form changes to the day', async () => {
    const f = await ledgerFixture();
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'taxation', validFrom: '2026-10-14', value: 'regular' }));
    const line = { categoryId: f.purposeIncome.id, amountCents: 35000, taxCode: 'reduced' as const };
    const before = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-10-13', text: 'Entgelt', moneyLines: [{ accountId: f.bank.id, amountCents: 35000 }], allocationLines: [line] }));
    const after = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-10-14', text: 'Entgelt', moneyLines: [{ accountId: f.bank.id, amountCents: 35000 }], allocationLines: [line] }));
    expect(before.taxTotals.outputTaxCents).toBe(0);
    expect(after.taxTotals.outputTaxCents).toBe(2290);
    expect(after.allocationLines[0]!.tax).toMatchObject({ netCents: 32710 });
  });

  it('refuses to finalize a taxed line for a date without a rate', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    const bank = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
    const category = deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'purpose-income')).get()!;
    unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2006-01-01', endsOn: '2006-12-31' }));
    const d = unwrap(await saveDraft(deps, ctx, { entryDate: '2006-06-01', text: 'x', moneyLines: [{ accountId: bank.id, amountCents: 100 }], allocationLines: [{ categoryId: category.id, amountCents: 100, taxCode: 'reduced' }] }));
    expect(err(await finalizeEntry(deps, ctx, { id: d.id }))).toMatchObject({ type: 'conflict', code: 'noTaxRateForDate' });
  });
});
