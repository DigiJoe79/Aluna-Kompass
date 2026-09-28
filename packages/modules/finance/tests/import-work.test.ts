import { newId, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { saveImportRule } from '../src/import/rules';
import { getWorkCounts, listWorkItems } from '../src/import/work';
import { saveDraft, setReviewed } from '../src/ledger/entries';
import { createOpenItem } from '../src/ledger/open-items';
import { financeImportCandidates } from '../src/schema';
import { insertRaw, insertRun, ledgerFixture } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

function candidate(f: Fixture, runId: string, decision: 'same' | 'own' | null = null): void {
  f.deps.db.insert(financeImportCandidates).values({ id: newId(), runId, accountId: f.bank.id, line: '{}', matchesRawTransactionId: null, dedupKey: 'k', decision, decidedAt: decision ? '2026-03-02T00:00:00.000Z' : null, decidedByUserId: decision ? f.userId : null, rawTransactionId: null }).run();
}

/**
 * Je Reiter etwas: drei sichere Vorschläge (Regel), zwei Umsätze ohne
 * Vorschlag, ein Agenten-Entwurf, ein geprüfter Entwurf, eine überfällige
 * offene Zahlung, ein zurückgehaltener Kandidat.
 */
async function workFixture() {
  const f = await ledgerFixture();
  const run = insertRun(f, f.bank.id);
  unwrap(await saveImportRule(f.deps, f.ctx, { name: 'Büromaterial', textContains: 'büromaterial', categoryId: f.programCosts.id }));
  const sure1 = insertRaw(f, run, { accountId: f.bank.id, amountCents: -1000, purpose: 'Büromaterial 1', date: '2026-03-02', iban: null });
  const sure2 = insertRaw(f, run, { accountId: f.bank.id, amountCents: -1100, purpose: 'Büromaterial 2', date: '2026-03-01', iban: null });
  const sure3 = insertRaw(f, run, { accountId: f.bank.id, amountCents: -1200, purpose: 'Büromaterial 3', date: '2026-03-03', iban: null });
  const unsure1 = insertRaw(f, run, { accountId: f.bank.id, amountCents: 700, purpose: 'Irgendwas', date: '2026-03-04', iban: null });
  const unsure2 = insertRaw(f, run, { accountId: f.bank.id, amountCents: 800, purpose: 'Auch irgendwas', date: '2026-03-05', iban: null });

  // Vom Agenten vorbereitet: Entwurf über MCP, der einen Kontoumsatz bindet.
  const agentRaw = insertRaw(f, run, { accountId: f.bank.id, amountCents: 2500, purpose: 'Spende April', date: '2026-03-06' });
  const agentDraft = unwrap(await saveDraft(f.deps, { ...f.ctx, channel: 'mcp' }, { entryDate: '2026-03-06', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 2500, rawTransactionId: agentRaw }], allocationLines: [{ categoryId: f.donations.id, amountCents: 2500 }] }));
  // Ein MCP-Entwurf ohne Kontoumsatz gehört nicht auf diesen Reiter.
  unwrap(await saveDraft(f.deps, { ...f.ctx, channel: 'mcp' }, { entryDate: '2026-03-06', text: 'Hand', moneyLines: [{ accountId: f.bank.id, amountCents: 900 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 900 }] }));

  // Geprüft, nicht festgeschrieben.
  const reviewed = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-07', text: 'Geprüft', moneyLines: [{ accountId: f.bank.id, amountCents: 4000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 4000 }] }));
  unwrap(await setReviewed(f.deps, f.ctx, { id: reviewed.id, reviewed: true }));

  // Fällig: überfällig (Stichtag der Tests ist der 5. September 2026) und noch nicht fällig.
  const overdue = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-08-01', amountCents: 5000, dueOn: '2026-08-31' }));
  unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-08-01', amountCents: 5000, dueOn: '2026-09-30' }));

  candidate(f, run);
  candidate(f, run, 'same');
  candidate(f, insertRun(f, f.bank.id, { discarded: true }));

  return { ...f, run, sure1, sure2, sure3, unsure1, unsure2, agentRaw, agentDraft, reviewed, overdue };
}

describe('getWorkCounts', () => {
  it('counts the five tabs and the held candidates; overview alone is refused', async () => {
    const f = await workFixture();
    expect(unwrap(await getWorkCounts(f.deps, ctxWith(['finance.read'])))).toEqual({ open: 3, unsure: 2, agent: 1, reviewed: 1, due: 1, heldCandidates: 1 });
    expect(await getWorkCounts(f.deps, ctxWith(['finance.overview']))).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.read' } });
  });
});

describe('listWorkItems', () => {
  it('lists open transactions with a short suggestion and pages them', async () => {
    const f = await workFixture();
    const page1 = unwrap(await listWorkItems(f.deps, f.ctx, { tab: 'open', limit: 2, offset: 0 }));
    expect(page1.total).toBe(3);
    // Älteste zuerst.
    expect(page1.items.map((i) => (i.type === 'transaction' ? i.transaction.id : null))).toEqual([f.sure2, f.sure1]);
    expect(page1.items[0]).toMatchObject({
      type: 'transaction',
      transaction: { id: f.sure2, accountId: f.bank.id, amountCents: -1100, purpose: 'Büromaterial 2', state: 'open' },
      suggestion: { kind: 'rule', confidence: 'sure', reasons: [{ kind: 'rule', ruleName: 'Büromaterial' }] },
    });
    // Kurzform: keine Vorbelegung in der Liste.
    expect(page1.items[0]).not.toHaveProperty('suggestion.draft');
    const page2 = unwrap(await listWorkItems(f.deps, f.ctx, { tab: 'open', limit: 2, offset: 2 }));
    expect(page2.items.map((i) => (i.type === 'transaction' ? i.transaction.id : null))).toEqual([f.sure3]);

    const unsure = unwrap(await listWorkItems(f.deps, f.ctx, { tab: 'unsure' }));
    expect(unsure.items.map((i) => (i.type === 'transaction' ? [i.transaction.id, i.suggestion.kind, i.suggestion.confidence] : null))).toEqual([
      [f.unsure1, 'none', 'unsure'],
      [f.unsure2, 'none', 'unsure'],
    ]);
  });

  it('filters by account', async () => {
    const f = await workFixture();
    expect(unwrap(await listWorkItems(f.deps, f.ctx, { tab: 'open', accountId: f.bank.id })).total).toBe(3);
    expect(unwrap(await listWorkItems(f.deps, f.ctx, { tab: 'open', accountId: f.cash.id })).total).toBe(0);
    expect(unwrap(await listWorkItems(f.deps, f.ctx, { tab: 'reviewed', accountId: f.cash.id })).total).toBe(0);
  });

  it('lists agent drafts, reviewed drafts and overdue open items as entries and open items', async () => {
    const f = await workFixture();
    expect(unwrap(await listWorkItems(f.deps, f.ctx, { tab: 'agent' })).items).toEqual([
      expect.objectContaining({ type: 'entry', entry: expect.objectContaining({ id: f.agentDraft.id, text: 'Spende', entryDate: '2026-03-06', status: 'draft', reviewedAt: null, createdChannel: 'mcp', totalCents: 2500, moneyLines: [{ accountId: f.bank.id, amountCents: 2500, rawTransactionId: f.agentRaw }] }) }),
    ]);
    expect(unwrap(await listWorkItems(f.deps, f.ctx, { tab: 'reviewed' })).items).toEqual([expect.objectContaining({ type: 'entry', entry: expect.objectContaining({ id: f.reviewed.id }) })]);
    expect(unwrap(await listWorkItems(f.deps, f.ctx, { tab: 'due' })).items).toEqual([expect.objectContaining({ type: 'openItem', openItem: expect.objectContaining({ id: f.overdue.id, kind: 'payable', dueOn: '2026-08-31', openCents: 5000 }) })]);
  });

  it('needs finance.read and a known tab', async () => {
    const f = await workFixture();
    expect(await listWorkItems(f.deps, ctxWith(['finance.overview']), { tab: 'open' })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.read' } });
    expect(await listWorkItems(f.deps, f.ctx, { tab: 'everything' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});
