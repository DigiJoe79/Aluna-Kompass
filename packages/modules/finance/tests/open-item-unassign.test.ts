import { schema, unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { assignPaymentToOpenItem, listAssignablePayments, unassignPaymentFromOpenItem } from '../src/ledger/assign-payment';
import { entryViewInternal } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { countingPaymentsInternal, listOpenItemSettlements, openCentsInternal, openItemHasAnySettlementInternal, updateOpenItem } from '../src/ledger/open-items';
import { reverseEntry } from '../src/ledger/reverse';
import { financeOpenItemSettlements } from '../src/schema';
import { assignFixture } from './assign-fixture';

type F = Awaited<ReturnType<typeof assignFixture>>;
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const auditOf = (f: F, action: string) => f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action)).all().map((e) => ({ ...e, params: e.params ? (JSON.parse(e.params) as Record<string, unknown>) : null }));

/** Ein Beitrag mit nachträglich zugeordneter Zahlung von 60 €. */
async function assigned(f: F, o: { itemDate?: string; date?: string } = {}) {
  const item = f.feeItem({ itemDate: o.itemDate });
  const pay = await f.pay({ cents: 6000, date: o.date ?? '2026-02-14' });
  unwrap(await assignPaymentToOpenItem(f.deps, f.ctx, { openItemId: item.id, moneyLineId: pay.lineId }));
  const settlement = f.deps.db.select().from(financeOpenItemSettlements).where(eq(financeOpenItemSettlements.openItemId, item.id)).get()!;
  return { item, pay, settlement };
}
const unassign = (f: F, settlementId: string, ctx = f.ctx) => unassignPaymentFromOpenItem(f.deps, ctx, { settlementId });

describe('unassignPaymentFromOpenItem (Spec Zahlung zuordnen § 3.3)', () => {
  it('releases the assignment: the item is open again, the row stays with its day, the protocol names number and amount', async () => {
    const f = await assignFixture();
    const { item, pay, settlement } = await assigned(f);
    expect(unwrap(await unassign(f, settlement.id))).toMatchObject({ id: item.id, state: 'open', openCents: 6000 });
    expect(f.deps.db.select().from(financeOpenItemSettlements).where(eq(financeOpenItemSettlements.id, settlement.id)).get()).toMatchObject({ releasedAt: expect.any(String), releasedByUserId: f.userId, assignedAt: settlement.assignedAt });
    const [entry] = auditOf(f, 'finance.openItem.unassignPayment');
    expect(entry).toMatchObject({ entityType: 'financeOpenItem', entityId: item.id, params: { entryNumber: pay.entry.number, amountCents: 6000 } });
    expect(JSON.stringify(entry)).not.toContain(f.member.id);
  });

  it('needs finance.entriesWrite, validates, an agent may', async () => {
    const f = await assignFixture();
    const { settlement } = await assigned(f);
    expect(err(await unassign(f, settlement.id, { ...f.ctx, permissions: new Set(['finance.read']) }))).toMatchObject({ type: 'forbidden', permission: 'finance.entriesWrite' });
    expect(err(await unassignPaymentFromOpenItem(f.deps, f.ctx, {}))).toMatchObject({ type: 'validation' });
    expect(err(await unassign(f, settlement.id, { ...f.ctx, channel: 'mcp' }))).toBe('ok');
    expect(err(await unassign(f, settlement.id))).toMatchObject({ type: 'notFound' });
  });

  it('a settlement from booking belongs to the entry', async () => {
    const f = await assignFixture();
    const item = f.feeItem();
    await f.pay({ cents: 6000, date: '2026-02-14', settlements: [{ openItemId: item.id, amountCents: 6000 }] });
    const settlement = f.deps.db.select().from(financeOpenItemSettlements).where(eq(financeOpenItemSettlements.openItemId, item.id)).get()!;
    expect(err(await unassign(f, settlement.id))).toMatchObject({ code: 'settlementNotAssigned' });
    expect(unwrap(await listOpenItemSettlements(f.deps, f.ctx, { openItemId: item.id }))[0]).toMatchObject({ settlementId: settlement.id, assignedAt: null, unassignable: false, unassignBlockedBy: null });
  });

  it('a return pointing at the assignment reopens the item and blocks the release', async () => {
    const f = await assignFixture();
    const { item, settlement } = await assigned(f);
    unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: '2026-02-20', text: 'Rückgabe',
        moneyLines: [{ accountId: f.bank.id, amountCents: -6000, settlements: [{ openItemId: item.id, amountCents: 6000, reversesSettlementId: settlement.id }] }],
        allocationLines: [{ categoryId: f.feeCategory.id, amountCents: -6000, contactId: f.member.id }],
      }),
    );
    expect(openCentsInternal(f.deps.db, item.id)).toBe(6000);
    expect(err(await unassign(f, settlement.id))).toMatchObject({ code: 'assignmentHasReturn' });
    const rows = unwrap(await listOpenItemSettlements(f.deps, f.ctx, { openItemId: item.id }));
    expect(rows.find((r) => r.settlementId === settlement.id)).toMatchObject({ assignedAt: settlement.assignedAt, unassignable: false, unassignBlockedBy: 'assignmentHasReturn' });
  });

  it('J: refused when the later day lies in a closed year', async () => {
    const f = await assignFixture();
    const { settlement } = await assigned(f, { itemDate: '2025-11-01', date: '2025-12-10' });
    f.closeYear(f.years['2025']!.id);
    expect(err(await unassign(f, settlement.id))).toMatchObject({ code: 'fiscalYearClosed' });
  });

  it('assigning again after the release writes a new row; the released one stays', async () => {
    const f = await assignFixture();
    const { item, pay, settlement } = await assigned(f);
    unwrap(await unassign(f, settlement.id));
    unwrap(await assignPaymentToOpenItem(f.deps, f.ctx, { openItemId: item.id, moneyLineId: pay.lineId }));
    const rows = f.deps.db.select().from(financeOpenItemSettlements).where(eq(financeOpenItemSettlements.openItemId, item.id)).all();
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.releasedAt === null)).toHaveLength(1);
    expect(openCentsInternal(f.deps.db, item.id)).toBe(0);
  });

  it('a reversed payment drops the assignment by itself', async () => {
    const f = await assignFixture();
    const { item, pay } = await assigned(f);
    unwrap(await reverseEntry(f.deps, f.ctx, { id: pay.entry.id }));
    expect(openCentsInternal(f.deps.db, item.id)).toBe(6000);
    expect(unwrap(await listOpenItemSettlements(f.deps, f.ctx, { openItemId: item.id }))).toEqual([]);
  });

  it('after the release no sum counts the assignment, and the item may be changed again', async () => {
    const f = await assignFixture();
    const item = await f.plainItem();
    const pay = await f.pay({ cents: 6000, date: '2026-02-14' });
    unwrap(await assignPaymentToOpenItem(f.deps, f.ctx, { openItemId: item.id, moneyLineId: pay.lineId }));
    expect(openItemHasAnySettlementInternal(f.deps.db, item.id)).toBe(true);
    const settlement = f.deps.db.select().from(financeOpenItemSettlements).where(eq(financeOpenItemSettlements.openItemId, item.id)).get()!;
    unwrap(await unassign(f, settlement.id));
    expect(openCentsInternal(f.deps.db, item.id)).toBe(6000);
    expect(countingPaymentsInternal(f.deps.db, item.id)).toEqual([]);
    expect(unwrap(await listAssignablePayments(f.deps, f.ctx, { openItemId: item.id }))[0]).toMatchObject({ moneyLineId: pay.lineId, freeCents: 6000, assignedTo: [] });
    expect(openItemHasAnySettlementInternal(f.deps.db, item.id)).toBe(false);
    expect(err(await updateOpenItem(f.deps, f.ctx, { id: item.id, dueOn: '2026-04-30' }))).toBe('ok');
  });

  it('the settlements of an item say which are assignments and may be released', async () => {
    const f = await assignFixture();
    const { item, settlement } = await assigned(f);
    expect(unwrap(await listOpenItemSettlements(f.deps, f.ctx, { openItemId: item.id }))).toEqual([expect.objectContaining({ settlementId: settlement.id, assignedAt: settlement.assignedAt, unassignable: true, unassignBlockedBy: null, amountCents: 6000 })]);
  });

  it('the entry shows its assignments with day and person, a released one as a trace', async () => {
    const f = await assignFixture();
    const { pay, settlement } = await assigned(f);
    const live = entryViewInternal(f.deps.db, pay.entry.id)!.moneyLines[0]!;
    expect(live.settlements).toEqual([expect.objectContaining({ id: settlement.id, assignedAt: settlement.assignedAt, assignedByUserId: f.userId, releasedAt: null })]);
    expect(live.releasedSettlements).toEqual([]);
    unwrap(await unassign(f, settlement.id));
    const after = entryViewInternal(f.deps.db, pay.entry.id)!.moneyLines[0]!;
    expect(after.settlements).toEqual([]);
    expect(after.releasedSettlements).toEqual([expect.objectContaining({ id: settlement.id, assignedAt: settlement.assignedAt, releasedAt: expect.any(String) })]);
  });
});
