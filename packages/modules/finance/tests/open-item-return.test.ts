import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { bookFromTransaction } from '../src/import/book';
import { suggestForTransaction } from '../src/import/suggestions';
import { bookEntry, finalizeEntry } from '../src/ledger/finalize';
import { createOpenItem, listOpenItems, openCentsInternal, openItemsAtInternal } from '../src/ledger/open-items';
import { reverseEntry } from '../src/ledger/reverse';
import { insertRaw, insertRun, ledgerFixture } from './helpers';

// Spec Mitglieder und Lastschrift § 6.2, Plan M2 Task 3: Eine gebuchte Rückgabe öffnet die Posten wieder, die die
// zurückgegebene Zahlung ausgeglichen hatte — über Rück-Ausgleiche (positiver Betrag, Verweis `reversesSettlementId`).
type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const itemView = async (f: Fixture, id: string) => unwrap(await listOpenItems(f.deps, f.ctx, { state: 'all' })).items.find((i) => i.id === id)!;

/** Eine Forderung über 12,00 €, per Lastschrift eingegangen und festgeschrieben, und die Rücklastschrift im Auszug. */
async function paidByDebit(f: Fixture) {
  const run = insertRun(f, f.bank.id);
  const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 1200, contactId: f.donor.id }));
  const incoming = insertRaw(f, run, { accountId: f.bank.id, amountCents: 1200, date: '2026-03-05', purpose: 'Lastschrift Beitrag', endToEndId: 'LS-2026-0007' });
  const origin = unwrap(await bookEntry(f.deps, f.ctx, {
    entryDate: '2026-03-05', text: 'Beitrag',
    moneyLines: [{ accountId: f.bank.id, amountCents: 1200, rawTransactionId: incoming, settlements: [{ openItemId: item.id, amountCents: 1200 }] }],
    allocationLines: [{ categoryId: f.donations.id, amountCents: 1200, contactId: f.donor.id }],
  }));
  const returned = insertRaw(f, run, { accountId: f.bank.id, amountCents: -1200, date: '2026-03-10', purpose: 'Rücklastschrift', returnCode: 'MD06', endToEndId: 'LS-2026-0007', lineIndex: 2 });
  return { item, origin, originSettlementId: origin.moneyLines[0]!.settlements[0]!.id, returned };
}

/** Den Vorschlag zur Rückgabe als Entwurf übernehmen, wie die Arbeitsliste es tut (Begleichungen der eigenen Geldzeile mit). */
async function draftFromSuggestion(f: Fixture, rawTransactionId: string) {
  const suggestion = unwrap(await suggestForTransaction(f.deps, f.ctx, { rawTransactionId }));
  const own = suggestion.draft!.moneyLines[0]!;
  const draft = unwrap(await bookFromTransaction(f.deps, f.ctx, { rawTransactionId, text: suggestion.draft!.text, allocationLines: suggestion.draft!.allocationLines, settlements: own.settlements, reviewed: false }));
  return { suggestion, draft };
}

describe('a return reopens the items the returned payment settled', () => {
  it('booked return reopens the item', async () => {
    const f = await ledgerFixture();
    const { item, originSettlementId, returned } = await paidByDebit(f);
    expect(openCentsInternal(f.deps.db, item.id)).toBe(0);

    const { suggestion, draft } = await draftFromSuggestion(f, returned);
    expect(suggestion).toMatchObject({ kind: 'return', confidence: 'sure' });
    expect(suggestion.draft!.moneyLines[0]!.settlements).toEqual([{ openItemId: item.id, amountCents: 1200, reversesSettlementId: originSettlementId }]);

    unwrap(await finalizeEntry(f.deps, f.ctx, { id: draft.id }));
    expect(openCentsInternal(f.deps.db, item.id)).toBe(1200);
    expect(await itemView(f, item.id)).toMatchObject({ state: 'open', openCents: 1200, settledCents: 0 });
  });

  it('draft return does not reopen yet', async () => {
    const f = await ledgerFixture();
    const { item, returned } = await paidByDebit(f);
    await draftFromSuggestion(f, returned);
    expect(openCentsInternal(f.deps.db, item.id)).toBe(0);
    expect(await itemView(f, item.id)).toMatchObject({ state: 'settled', openCents: 0, draftSettlementCents: 0 });
  });

  it('opens on the day of the return, not before (Stichtag)', async () => {
    const f = await ledgerFixture();
    const { item, returned } = await paidByDebit(f);
    const { draft } = await draftFromSuggestion(f, returned);
    unwrap(await finalizeEntry(f.deps, f.ctx, { id: draft.id }));
    expect(openItemsAtInternal(f.deps.db, '2026-03-09')).toEqual([]);
    expect(openItemsAtInternal(f.deps.db, '2026-03-10')).toEqual([{ id: item.id, kind: 'receivable', openCents: 1200 }]);
  });

  it('reversing the return settles the item again; reversing the origin afterwards does not open it twice', async () => {
    const f = await ledgerFixture();
    const { item, origin, returned } = await paidByDebit(f);
    const { draft } = await draftFromSuggestion(f, returned);
    const back = unwrap(await finalizeEntry(f.deps, f.ctx, { id: draft.id }));
    unwrap(await reverseEntry(f.deps, f.ctx, { id: back.id }));
    expect(openCentsInternal(f.deps.db, item.id)).toBe(0);
    unwrap(await reverseEntry(f.deps, f.ctx, { id: origin.id }));
    expect(openCentsInternal(f.deps.db, item.id)).toBe(1200);
  });

  it('partial return reopens at most the returned amount', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const first = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 1200, contactId: f.donor.id }));
    const second = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 1800, contactId: f.donor.id }));
    const incoming = insertRaw(f, run, { accountId: f.bank.id, amountCents: 3000, date: '2026-03-05', purpose: 'Beiträge' });
    const origin = unwrap(await bookEntry(f.deps, f.ctx, {
      entryDate: '2026-03-05', text: 'Beiträge',
      moneyLines: [{ accountId: f.bank.id, amountCents: 3000, rawTransactionId: incoming, settlements: [{ openItemId: first.id, amountCents: 1200 }, { openItemId: second.id, amountCents: 1800 }] }],
      allocationLines: [{ categoryId: f.donations.id, amountCents: 3000, contactId: f.donor.id }],
    }));
    const settlementOf = (itemId: string) => origin.moneyLines[0]!.settlements.find((s) => s.openItemId === itemId)!.id;

    // Die Summe passt nicht zur Zahlung: kein Vorschlag mit Rück-Ausgleich — die Aufteilung bleibt dem Menschen.
    const returned = insertRaw(f, run, { accountId: f.bank.id, amountCents: -1200, date: '2026-03-10', purpose: 'Rückgabe', returnCode: 'MD06', lineIndex: 2 });
    const suggestion = unwrap(await suggestForTransaction(f.deps, f.ctx, { rawTransactionId: returned }));
    expect((suggestion.draft?.moneyLines ?? []).flatMap((l) => l.settlements ?? []).filter((s) => s.reversesSettlementId)).toEqual([]);

    const tooMuch = await bookEntry(f.deps, f.ctx, {
      entryDate: '2026-03-10', text: 'Rückgabe',
      moneyLines: [{ accountId: f.bank.id, amountCents: -1300, settlements: [{ openItemId: first.id, amountCents: 1300, reversesSettlementId: settlementOf(first.id) }] }],
      allocationLines: [{ categoryId: f.donations.id, amountCents: -1300, contactId: f.donor.id }],
    });
    expect(err(tooMuch)).toMatchObject({ type: 'conflict', code: 'reversalExceedsSettled' });

    unwrap(await bookEntry(f.deps, f.ctx, {
      entryDate: '2026-03-10', text: 'Rückgabe',
      moneyLines: [{ accountId: f.bank.id, amountCents: -1200, rawTransactionId: returned, settlements: [{ openItemId: first.id, amountCents: 1200, reversesSettlementId: settlementOf(first.id) }] }],
      allocationLines: [{ categoryId: f.donations.id, amountCents: -1200, contactId: f.donor.id }],
    }));
    expect(openCentsInternal(f.deps.db, first.id)).toBe(1200);
    expect(openCentsInternal(f.deps.db, second.id)).toBe(0);

    // Was schon zurückgenommen ist, lässt sich nicht noch einmal zurücknehmen.
    const again = await bookEntry(f.deps, f.ctx, {
      entryDate: '2026-03-11', text: 'Rückgabe',
      moneyLines: [{ accountId: f.bank.id, amountCents: -100, settlements: [{ openItemId: first.id, amountCents: 100, reversesSettlementId: settlementOf(first.id) }] }],
      allocationLines: [{ categoryId: f.donations.id, amountCents: -100, contactId: f.donor.id }],
    });
    expect(err(again)).toMatchObject({ type: 'conflict', code: 'reversalExceedsSettled' });
  });

  it('no reversal settlement against a reversed origin', async () => {
    const f = await ledgerFixture();
    const { item, origin, originSettlementId } = await paidByDebit(f);
    unwrap(await reverseEntry(f.deps, f.ctx, { id: origin.id }));
    expect(openCentsInternal(f.deps.db, item.id)).toBe(1200);
    const res = await bookEntry(f.deps, f.ctx, {
      entryDate: '2026-03-10', text: 'Rückgabe',
      moneyLines: [{ accountId: f.bank.id, amountCents: -1200, settlements: [{ openItemId: item.id, amountCents: 1200, reversesSettlementId: originSettlementId }] }],
      allocationLines: [{ categoryId: f.donations.id, amountCents: -1200, contactId: f.donor.id }],
    });
    expect(err(res)).toMatchObject({ type: 'conflict', code: 'reversalTargetInvalid' });
  });

  it('a reversal settlement must target a settlement of the same item', async () => {
    const f = await ledgerFixture();
    const { originSettlementId } = await paidByDebit(f);
    const other = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 1200 }));
    const res = await bookEntry(f.deps, f.ctx, {
      entryDate: '2026-03-10', text: 'Rückgabe',
      moneyLines: [{ accountId: f.bank.id, amountCents: -1200, settlements: [{ openItemId: other.id, amountCents: 1200, reversesSettlementId: originSettlementId }] }],
      allocationLines: [{ categoryId: f.donations.id, amountCents: -1200 }],
    });
    expect(err(res)).toMatchObject({ type: 'conflict', code: 'reversalTargetInvalid' });
  });

  it('reversal needs the opposite direction', async () => {
    const f = await ledgerFixture();
    const { item, originSettlementId } = await paidByDebit(f);
    const res = await bookEntry(f.deps, f.ctx, {
      entryDate: '2026-03-10', text: 'Rückgabe',
      moneyLines: [{ accountId: f.bank.id, amountCents: 1200, settlements: [{ openItemId: item.id, amountCents: 1200, reversesSettlementId: originSettlementId }] }],
      allocationLines: [{ categoryId: f.donations.id, amountCents: 1200 }],
    });
    expect(err(res)).toMatchObject({ type: 'conflict', code: 'settlementWrongDirection' });
  });
});
