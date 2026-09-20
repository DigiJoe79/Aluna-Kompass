import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { deleteDraft, getEntry, listEntries, saveDraft, setReviewed } from '../src/ledger/entries';
import { allowHumanOnlyOverMcp, ledgerFixture } from './helpers';

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
