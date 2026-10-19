import { fixedClock, schema, unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { FINANCE_DASHBOARD_TILES } from '../src/dashboard';
import { getDirectDebitRun } from '../src/direct-debit/runs';
import { bookFromTransaction } from '../src/import/book';
import { previewBatchFinalize } from '../src/import/batch';
import { saveDraft, setReviewed } from '../src/ledger/entries';
import { bookEntry, finalizeEntry, finalizeReviewed } from '../src/ledger/finalize';
import { createOpenItem } from '../src/ledger/open-items';
import { financeDirectDebitRuns, financeEntries, financeOpenItems } from '../src/schema';
import { bookFromSuggestion, creditScene, suggest, type CreditScene } from './direct-debit-credit-fixture';
import { insertRaw, insertRun } from './helpers';

// Plan N2 Task 2 (R2, R3; Rest M16/M17): Was der Vorschlag der Arbeitsliste schon nennt — Überweisung auf einen Beitrag
// im eingereichten Einzug, Überzahlung —, gilt auch beim Buchen und Festschreiben. Uhr: 20.10.2026, festgeschrieben am 22.10.

const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);
const later = (f: CreditScene) => ({ ...f.deps, clock: fixedClock('2026-10-22T08:00:00.000Z') });

/** Eine Überweisung von Erika über 50,00 € auf ihren Beitrag, der im eingereichten Einzug zum 30.10. steckt. */
async function transferOnSubmitted(f: CreditScene) {
  const statement = insertRun(f, f.bank.id);
  const raw = insertRaw(f, statement, { accountId: f.bank.id, amountCents: 5000, date: '2026-10-20', purpose: 'Beitrag 2026 Mitglied 0001', name: 'Erika Beispiel', iban: 'DE02999999990000111111' });
  return unwrap(await bookFromTransaction(f.deps, f.ctx, { rawTransactionId: raw, text: 'Beitrag', allocationLines: [{ categoryId: f.membership, amountCents: 5000, contactId: f.a.contactId }], settlements: [{ openItemId: f.feeId, amountCents: 5000 }], reviewed: true }));
}

/** Ein Beitrag über 12,00 € ohne Einzug und eine Zahlung über 15,00 €, ganz auf die Beitragskategorie gelegt. */
async function overpaidDraft(f: CreditScene, o: { settle?: number; lines?: { categoryId: string; amountCents: number }[] } = {}) {
  const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-10-01', contactId: f.a.contactId, amountCents: 1200, dueOn: '2026-10-15', paymentReference: 'Beitrag 2026 Mitglied 0005' }));
  f.deps.db.update(financeOpenItems).set({ lineTemplate: JSON.stringify([{ categoryId: f.membership, contactId: f.a.contactId }]) }).where(eq(financeOpenItems.id, item.id)).run();
  const statement = insertRun(f, f.bank.id);
  const raw = insertRaw(f, statement, { accountId: f.bank.id, amountCents: 1500, date: '2026-10-16', purpose: 'Beitrag 2026 Mitglied 0005', name: 'Erika Beispiel', iban: 'DE02999999990000111111' });
  const lines = (o.lines ?? [{ categoryId: f.membership, amountCents: 1500 }]).map((l) => ({ ...l, contactId: f.a.contactId }));
  const view = unwrap(await bookFromTransaction(f.deps, f.ctx, { rawTransactionId: raw, text: 'Beitrag', allocationLines: lines, settlements: [{ openItemId: item.id, amountCents: o.settle ?? 1200 }], reviewed: true }));
  return { item, view };
}

const lastFinalizeAudit = (f: CreditScene) => {
  const row = f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'finance.entry.finalize').at(-1)!;
  return JSON.parse(row.after ?? '{}') as Record<string, unknown>;
};

describe('a transfer on a fee in a submitted collection (R2)', () => {
  it('booking names the collection day; finalizing needs the acknowledgement and records it', async () => {
    const f = await creditScene();
    const draft = await transferOnSubmitted(f);
    expect(draft).toMatchObject({ status: 'draft', warnings: ['inSubmittedRun'], warningParams: { inSubmittedRun: { date: '2026-10-30' } } });
    expect(fail(await finalizeEntry(later(f), f.ctx, { id: draft.id }))).toMatchObject({ type: 'conflict', code: 'inSubmittedRunNotAcknowledged', params: { date: '2026-10-30' } });
    expect(f.deps.db.select().from(financeEntries).where(eq(financeEntries.id, draft.id)).get()!.status).toBe('draft');
    const final = unwrap(await finalizeEntry(later(f), f.ctx, { id: draft.id, acknowledgedWarnings: ['inSubmittedRun'] }));
    expect(final).toMatchObject({ status: 'final', warnings: [] });
    expect(lastFinalizeAudit(f)).toMatchObject({ acknowledgedWarnings: ['inSubmittedRun'] });
  });

  it('after finalizing anyway, the collection shows the item as already paid and the dashboard reports it', async () => {
    const f = await creditScene();
    const draft = await transferOnSubmitted(f);
    unwrap(await finalizeEntry(later(f), f.ctx, { id: draft.id, acknowledgedWarnings: ['inSubmittedRun'] }));
    const run = unwrap(await getDirectDebitRun(later(f), f.ctx, { id: f.run.id }));
    expect(run.items.find((i) => i.sourceId === f.feeId)).toMatchObject({ paidOtherwise: true });
    expect(run.items.find((i) => i.source === 'pledge')).toMatchObject({ paidOtherwise: false });
    expect(run.paidOtherwise).toBe(1);
    const tile = FINANCE_DASHBOARD_TILES.find((t) => t.key === 'directDebitDue')!;
    expect(await tile.load(later(f), f.ctx, {})).toEqual({ kind: 'status', tone: 'warning', messageKey: 'paidOtherwise', values: { date: '30.10.2026', count: 1 }, href: `/finance/direct-debit/runs/${f.run.id}` });

    // U2 (Plan N3): Ein verfallener Einzug daneben verdrängt die Warnung zum Geld nicht — sie hat die Frist und steht
    // zuerst, der verfallene Einzug wird mitgenannt.
    const stamp = '2026-09-20T08:00:00.000Z';
    f.deps.db.insert(financeDirectDebitRuns).values({ id: 'expired-run', collectionDate: '2026-10-05', accountId: f.bank.id, status: 'draft', messageId: 'EXPIRED-1', createdByUserId: 'u', createdAt: stamp, updatedAt: stamp }).run();
    expect(await tile.load(later(f), f.ctx, {})).toEqual({ kind: 'status', tone: 'warning', messageKey: 'paidOtherwiseAndExpired', values: { date: '30.10.2026', count: 1, expiredDate: '05.10.2026' }, href: `/finance/direct-debit/runs/${f.run.id}` });
  });

  it('the credit of the collection itself is no warning', async () => {
    const f = await creditScene();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-10-20', text: 'Gutschrift', moneyLines: [{ accountId: f.bank.id, amountCents: 5000, settlements: [{ openItemId: f.feeId, amountCents: 5000 }] }], allocationLines: [{ categoryId: f.membership, amountCents: 5000, contactId: f.a.contactId, directDebitItemId: f.itemOf('openItem').id }] }));
    expect(draft.warnings).toEqual([]);
  });
});

describe('a payment over the open amount (R3, E4)', () => {
  it('booking names the amount over; finalizing needs the acknowledgement', async () => {
    const f = await creditScene();
    const { view } = await overpaidDraft(f);
    expect(view).toMatchObject({ warnings: ['overpaid'], warningParams: { overpaid: { amountCents: 300, via: 'payment' } } });
    // U9 (Plan N3): Warnung und Ablehnung nennen den Betrag unter demselben Namen.
    expect(fail(await finalizeEntry(later(f), f.ctx, { id: view.id }))).toMatchObject({ type: 'conflict', code: 'overpaidNotAcknowledged', params: { amountCents: 300 } });
    expect(unwrap(await finalizeEntry(later(f), f.ctx, { id: view.id, acknowledgedWarnings: ['overpaid'] }))).toMatchObject({ status: 'final' });
    expect(lastFinalizeAudit(f)).toMatchObject({ acknowledgedWarnings: ['overpaid'] });
  });

  it('also when the settlement itself is above the open amount', async () => {
    const f = await creditScene();
    const { view } = await overpaidDraft(f, { settle: 1500 });
    expect(view).toMatchObject({ warnings: ['overpaid'], warningParams: { overpaid: { amountCents: 300 } } });
  });

  it('no warning when the rest goes elsewhere (a donation)', async () => {
    const f = await creditScene();
    const { view } = await overpaidDraft(f, { lines: [{ categoryId: f.membership, amountCents: 1200 }, { categoryId: f.donations, amountCents: 300 }] });
    expect(view.warnings).toEqual([]);
  });

  it('booking in one step needs the acknowledgement too', async () => {
    const f = await creditScene();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-10-01', contactId: f.a.contactId, amountCents: 1200, dueOn: '2026-10-15', paymentReference: 'Beitrag 2026 Mitglied 0006' }));
    f.deps.db.update(financeOpenItems).set({ lineTemplate: JSON.stringify([{ categoryId: f.membership }]) }).where(eq(financeOpenItems.id, item.id)).run();
    const lines = { entryDate: '2026-10-16', text: 'Beitrag', moneyLines: [{ accountId: f.bank.id, amountCents: 1500, settlements: [{ openItemId: item.id, amountCents: 1200 }] }], allocationLines: [{ categoryId: f.membership, amountCents: 1500 }] };
    expect(fail(await bookEntry(f.deps, f.ctx, lines))).toMatchObject({ type: 'conflict', code: 'overpaidNotAcknowledged' });
    expect(f.deps.db.select().from(financeEntries).all().filter((e) => e.text === 'Beitrag')).toEqual([]);
    expect(unwrap(await bookEntry(f.deps, f.ctx, { ...lines, acknowledgedWarnings: ['overpaid'] }))).toMatchObject({ status: 'final' });
  });
});

describe('finalizing many reviewed drafts (Review Focus 1)', () => {
  it('keeps drafts with an open warning as drafts and names them; the others are finalized', async () => {
    const f = await creditScene();
    const { view: warned } = await overpaidDraft(f);
    const plain = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-10-16', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 2000 }], allocationLines: [{ categoryId: f.donations, amountCents: 2000 }] }));
    unwrap(await setReviewed(f.deps, f.ctx, { id: plain.id, reviewed: true }));
    const preview = unwrap(await previewBatchFinalize(later(f), f.ctx, {}));
    expect(preview.problems).toEqual([]);
    expect(preview.held).toEqual([{ entryId: warned.id, warnings: ['overpaid'], warningParams: { overpaid: { amountCents: 300, via: 'payment' } } }]);
    expect(preview.entries).toBe(1);
    const done = unwrap(await finalizeReviewed(later(f), f.ctx, { ids: [warned.id, plain.id] }));
    expect(done.entries.map((e) => e.id)).toEqual([plain.id]);
    expect(done.held).toEqual([{ entryId: warned.id, warnings: ['overpaid'], warningParams: { overpaid: { amountCents: 300, via: 'payment' } } }]);
    expect(f.deps.db.select().from(financeEntries).where(eq(financeEntries.id, warned.id)).get()!.status).toBe('draft');
  });
});

describe('the credit of a collection with an item paid otherwise (U5, U9)', () => {
  it('the suggestion names the item already; the draft warns that the collection took it twice', async () => {
    const f = await creditScene();
    const paid = await transferOnSubmitted(f);
    unwrap(await finalizeEntry(later(f), f.ctx, { id: paid.id, acknowledgedWarnings: ['inSubmittedRun'] }));
    const credit = f.raw(11200);
    const s = await suggest(f, credit);
    expect(s).toMatchObject({ kind: 'directDebitRun', confidence: 'unsure', problems: ['paidOtherwise'], problemParams: { paidOtherwise: { count: 1, amountCents: 5000, items: [{ directDebitItemId: f.itemOf('openItem').id, openItemId: f.feeId, amountCents: 5000 }] } } });
    const draft = await bookFromSuggestion(f, credit, s);
    expect(draft.warnings).toContain('overpaid');
    expect(draft.warningParams).toMatchObject({ overpaid: { amountCents: 5000, via: 'directDebit' } });
    const afterCollection = { ...f.deps, clock: fixedClock('2026-11-10T08:00:00.000Z') };
    expect(fail(await finalizeEntry(afterCollection, f.ctx, { id: draft.id }))).toMatchObject({ type: 'conflict', code: 'overpaidByCollectionNotAcknowledged', params: { amountCents: 5000 } });
  });

  it('a credit without such an item has no problem', async () => {
    const f = await creditScene();
    const s = await suggest(f, f.raw(11200));
    expect(s).toMatchObject({ confidence: 'sure', problems: [], problemParams: {} });
  });
});
