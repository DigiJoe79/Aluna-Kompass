import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documentLinks, documentTypes, documents } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { cancelOpenItem, createOpenItem, listOpenItems, listOpenItemSettlements, openCentsInternal, openItemsAtInternal, updateOpenItem } from '../src/ledger/open-items';
import { reverseEntry } from '../src/ledger/reverse';
import { financeOpenItemSettlements } from '../src/schema';
import { allowHumanOnlyOverMcp, ledgerFixture } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const now = '2026-03-01T10:00:00.000Z';

/** Ein festgeschriebenes Dokument der Art `letter` (ohne Bereich) — wie in `vouchers.test.ts`. */
function seedLetter(deps: Awaited<ReturnType<typeof ledgerFixture>>['deps'], id: string) {
  if (!deps.db.select({ key: documentTypes.key }).from(documentTypes).where(eq(documentTypes.key, 'letter')).get()) {
    deps.db.insert(documentTypes).values({ key: 'letter', label: 'Brief', prefix: 'BRF', defaultDirection: 'outgoing', retentionClass: 'statutory6Y', defaultFolder: null, isActive: true, sortOrder: 0, ownerModule: null, protectionArea: null }).run();
  }
  deps.db
    .insert(documents)
    .values({
      id, phase: 'issued', direction: 'outgoing', sourceKind: 'uploaded', typeKey: 'letter', number: `BRF-2026-${id}`, subject: 'Brief', documentDate: '2026-03-01', folder: null,
      draftBody: null, fileName: 'x', fileChecksum: 'abc', fileBytes: 1, textStatus: 'unavailable', textAttempts: 0, textError: null, textExtractedAt: null,
      status: 'issued', createdByUserId: 'U1', createdAt: now, updatedAt: now,
    })
    .run();
}

describe('open items', () => {
  it('Prüfstein 3: invoice in December, payment in January — open on 31 December, settled by the January entry, and the entry belongs to January', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2025-12-18', amountCents: 23800, dueOn: '2026-01-17', paymentReference: 'RE-4711' }));
    expect(openItemsAtInternal(f.deps.db, '2025-12-31')).toEqual([{ id: item.id, kind: 'payable', openCents: 23800 }]);
    const payment = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-01-10', text: 'Rechnung RE-4711', moneyLines: [{ accountId: f.bank.id, amountCents: -23800, settlements: [{ openItemId: item.id, amountCents: 23800 }] }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -23800 }] }));
    expect(payment.fiscalYearId).toBe(f.years['2026']!.id);
    expect(openItemsAtInternal(f.deps.db, '2025-12-31')).toHaveLength(1); // am Stichtag bleibt er offen
    expect(openItemsAtInternal(f.deps.db, '2026-01-31')).toEqual([]);
    expect(unwrap(await listOpenItems(f.deps, f.ctx, { state: 'all' })).items[0]).toMatchObject({ state: 'settled', openCents: 0, settledCents: 23800 });
  });

  it('a draft settles nothing', async () => {
    const f = await ledgerFixture();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 10000 }));
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Zahlungseingang', moneyLines: [{ accountId: f.bank.id, amountCents: 10000, settlements: [{ openItemId: item.id, amountCents: 10000 }] }], allocationLines: [{ categoryId: f.donations.id, amountCents: 10000 }] }));
    expect(openCentsInternal(f.deps.db, item.id)).toBe(10000);
    expect(unwrap(await listOpenItems(f.deps, f.ctx, { state: 'all' })).items[0]).toMatchObject({ state: 'open', settledCents: 0 });
  });

  it('a partial payment leaves the rest open; two payments settle it', async () => {
    const f = await ledgerFixture();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 10000 }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Teilzahlung', moneyLines: [{ accountId: f.bank.id, amountCents: 6000, settlements: [{ openItemId: item.id, amountCents: 6000 }] }], allocationLines: [{ categoryId: f.donations.id, amountCents: 6000 }] }));
    expect(openCentsInternal(f.deps.db, item.id)).toBe(4000);
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-10', text: 'Restzahlung', moneyLines: [{ accountId: f.bank.id, amountCents: 4000, settlements: [{ openItemId: item.id, amountCents: 4000 }] }], allocationLines: [{ categoryId: f.donations.id, amountCents: 4000 }] }));
    expect(openCentsInternal(f.deps.db, item.id)).toBe(0);
    expect(unwrap(await listOpenItems(f.deps, f.ctx, { state: 'settled' })).items).toHaveLength(1);
  });

  it('an overpayment shows as overpaid with a negative open amount', async () => {
    const f = await ledgerFixture();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 5000 }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Überzahlung', moneyLines: [{ accountId: f.bank.id, amountCents: 6000, settlements: [{ openItemId: item.id, amountCents: 6000 }] }], allocationLines: [{ categoryId: f.donations.id, amountCents: 6000 }] }));
    expect(openCentsInternal(f.deps.db, item.id)).toBe(-1000);
    expect(unwrap(await listOpenItems(f.deps, f.ctx, { state: 'all' })).items[0]).toMatchObject({ state: 'overpaid' });
  });

  it('one transfer settles several items (Sammelüberweisung)', async () => {
    const f = await ledgerFixture();
    const item1 = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-03-01', amountCents: 3000 }));
    const item2 = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-03-01', amountCents: 2000 }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Sammelüberweisung', moneyLines: [{ accountId: f.bank.id, amountCents: -5000, settlements: [{ openItemId: item1.id, amountCents: 3000 }, { openItemId: item2.id, amountCents: 2000 }] }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -5000 }] }));
    expect(openCentsInternal(f.deps.db, item1.id)).toBe(0);
    expect(openCentsInternal(f.deps.db, item2.id)).toBe(0);
  });

  it('lists the finalized, unreversed entries that settle an item, with their number — for "settled by" (Task 3, A6)', async () => {
    const f = await ledgerFixture();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 10000 }));
    expect(unwrap(await listOpenItemSettlements(f.deps, f.ctx, { openItemId: item.id }))).toEqual([]);

    const first = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Teilzahlung', moneyLines: [{ accountId: f.bank.id, amountCents: 6000, settlements: [{ openItemId: item.id, amountCents: 6000 }] }], allocationLines: [{ categoryId: f.donations.id, amountCents: 6000 }] }));
    const second = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-10', text: 'Restzahlung', moneyLines: [{ accountId: f.bank.id, amountCents: 4000, settlements: [{ openItemId: item.id, amountCents: 4000 }] }], allocationLines: [{ categoryId: f.donations.id, amountCents: 4000 }] }));
    const settlements = unwrap(await listOpenItemSettlements(f.deps, f.ctx, { openItemId: item.id }));
    expect(settlements).toHaveLength(2);
    expect(settlements.map((s) => s.entryId).sort()).toEqual([first.id, second.id].sort());
    expect(settlements.every((s) => s.entryNumber !== null)).toBe(true);

    unwrap(await reverseEntry(f.deps, f.ctx, { id: second.id }));
    const afterReverse = unwrap(await listOpenItemSettlements(f.deps, f.ctx, { openItemId: item.id }));
    expect(afterReverse.map((s) => s.entryId)).toEqual([first.id]); // die Gegenbuchung selbst begleicht nichts, das Storno ist auch keine Zahlung mehr

    expect(await listOpenItemSettlements(f.deps, f.ctx, { openItemId: 'nonexistent' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await listOpenItemSettlements(f.deps, ctxWith([], f.userId), { openItemId: item.id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });

  it('reversing the payment opens the item again — nothing is deleted', async () => {
    const f = await ledgerFixture();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 5000 }));
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Zahlung', moneyLines: [{ accountId: f.bank.id, amountCents: 5000, settlements: [{ openItemId: item.id, amountCents: 5000 }] }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] }));
    expect(openCentsInternal(f.deps.db, item.id)).toBe(0);
    unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id }));
    expect(openCentsInternal(f.deps.db, item.id)).toBe(5000);
    expect(f.deps.db.select().from(financeOpenItemSettlements).all()).toHaveLength(1);
  });

  it('a settlement must not exceed the money line and must have its sign: a payable is settled by an outflow, a receivable by an inflow', async () => {
    const f = await ledgerFixture();
    const payable = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-03-01', amountCents: 5000 }));
    expect(err(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: -3000, settlements: [{ openItemId: payable.id, amountCents: 4000 }] }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -3000 }] }))).toMatchObject({ type: 'conflict', code: 'settlementExceedsLine' });
    expect(err(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 3000, settlements: [{ openItemId: payable.id, amountCents: 3000 }] }], allocationLines: [{ categoryId: f.donations.id, amountCents: 3000 }] }))).toMatchObject({ type: 'conflict', code: 'settlementWrongDirection' });
  });

  it('can be changed until anything settles it, even a draft', async () => {
    const f = await ledgerFixture();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-03-01', amountCents: 5000, paymentReference: 'RE-1' }));
    const updated = unwrap(await updateOpenItem(f.deps, f.ctx, { id: item.id, expectedVersion: item.updatedAt, amountCents: 6000 }));
    expect(updated.amountCents).toBe(6000);
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: -6000, settlements: [{ openItemId: item.id, amountCents: 6000 }] }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -6000 }] }));
    expect(err(await updateOpenItem(f.deps, f.ctx, { id: item.id, expectedVersion: updated.updatedAt, amountCents: 7000 }))).toMatchObject({ type: 'conflict', code: 'openItemInUse' });
  });

  it('is never deleted: a mistake is closed without payment, with a note — unless something finalized hangs on it', async () => {
    const f = await ledgerFixture();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-03-01', amountCents: 5000 }));
    const cancelled = unwrap(await cancelOpenItem(f.deps, f.ctx, { id: item.id, note: 'Doppelt erfasst' }));
    expect(cancelled.state).toBe('cancelled');

    const item2 = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-03-01', amountCents: 5000 }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: -5000, settlements: [{ openItemId: item2.id, amountCents: 5000 }] }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -5000 }] }));
    expect(err(await cancelOpenItem(f.deps, f.ctx, { id: item2.id, note: 'x' }))).toMatchObject({ type: 'conflict', code: 'openItemHasPayments' });
  });

  it('checks that contact and document exist, and links the document for the file module', async () => {
    const f = await ledgerFixture();
    expect(err(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 5000, contactId: 'nope' }))).toMatchObject({ type: 'notFound', entity: 'contact' });
    expect(err(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 5000, documentId: 'nope' }))).toMatchObject({ type: 'notFound' });

    seedLetter(f.deps, 'DOC1');
    const withDms = ctxWith([...f.ctx.permissions, 'dms.view'], f.userId);
    const item = unwrap(await createOpenItem(f.deps, withDms, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 5000, contactId: f.donor.id, documentId: 'DOC1' }));
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, 'DOC1'), eq(documentLinks.entityType, 'financeOpenItem'), eq(documentLinks.entityId, item.id))).all()).toHaveLength(1);
  });

  it('needs finance.entriesWrite to write and finance.read to list', async () => {
    const f = await ledgerFixture();
    const overview = ctxWith(['finance.overview'], f.userId);
    expect(err(await createOpenItem(f.deps, overview, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 5000 }))).toEqual({ type: 'forbidden', permission: 'finance.entriesWrite' });
    expect(err(await listOpenItems(f.deps, overview, {}))).toEqual({ type: 'forbidden', permission: 'finance.read' });
  });

  it('cancelling without payment is a final step: it needs finance.entriesFinalize, not just finance.entriesWrite', async () => {
    const f = await ledgerFixture();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-03-01', amountCents: 5000 }));
    const writeOnly = ctxWith(['finance.entriesWrite'], f.userId);
    expect(err(await cancelOpenItem(f.deps, writeOnly, { id: item.id, note: 'x' }))).toEqual({ type: 'forbidden', permission: 'finance.entriesFinalize' });
  });

  it('is human only, like finalizing: refused over MCP unless the association allowed it', async () => {
    const f = await ledgerFixture();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-03-01', amountCents: 5000 }));
    const overMcp = { ...f.ctx, channel: 'mcp' as const };
    expect(err(await cancelOpenItem(f.deps, overMcp, { id: item.id, note: 'x' }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    allowHumanOnlyOverMcp(f.deps);
    const cancelled = unwrap(await cancelOpenItem(f.deps, overMcp, { id: item.id, note: 'x' }));
    expect(cancelled.state).toBe('cancelled');
  });

  it('an item with an origin is never closed without payment this way — it is settled through its own process', async () => {
    const f = await ledgerFixture();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-03-01', amountCents: 5000, originType: 'expenseClaim', originId: 'CLAIM-1' }));
    expect(err(await cancelOpenItem(f.deps, f.ctx, { id: item.id, note: 'x' }))).toMatchObject({ type: 'conflict', code: 'openItemHasOrigin' });
  });

  it('logs neither the payment reference nor the note nor the contact', async () => {
    const f = await ledgerFixture();
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-03-01', amountCents: 5000, paymentReference: 'KE-2026-012', contactId: f.donor.id }));
    unwrap(await cancelOpenItem(f.deps, f.ctx, { id: item.id, note: 'Geheime Begründung' }));
    const log = JSON.stringify(f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action.startsWith('finance.openItem.')));
    expect(log).not.toContain('KE-2026-012');
    expect(log).not.toContain('Geheime Begründung');
    expect(log).not.toContain(f.donor.id);
  });
});
