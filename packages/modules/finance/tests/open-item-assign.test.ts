import { schema, unwrap } from '@kompass/core';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { buildDirectDebitFile, createDirectDebitRun } from '../src/direct-debit/runs';
import { assignPaymentToOpenItem, listAssignablePayments } from '../src/ledger/assign-payment';
import { entryViewInternal, saveDraft } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { cancelOpenItem, createOpenItem, openItemsAtInternal } from '../src/ledger/open-items';
import { reverseEntry } from '../src/ledger/reverse';
import { financeCategories, financeConfirmationLines } from '../src/schema';
import { assignFixture } from './assign-fixture';
import { directDebitFixture } from './direct-debit-fixture';

const candidates = async (f: Awaited<ReturnType<typeof assignFixture>>, openItemId: string) => unwrap(await listAssignablePayments(f.deps, f.ctx, { openItemId }));

describe('listAssignablePayments (Spec Zahlung zuordnen § 3.5)', () => {
  it('orders free and fitting first, then by day; then with a purpose hint; blocked last', async () => {
    const f = await assignFixture();
    const item = f.feeItem();
    const smaller = await f.pay({ cents: 3000, date: '2026-05-01' });
    const fitting = await f.pay({ cents: 6000, date: '2026-02-14' });
    const hinted = await f.pay({ cents: 6000, date: '2026-08-03', purpose: 'Beitrag 2027' });
    const donation = await f.pay({ cents: 5000, date: '2026-01-20', categoryKey: 'donations' });
    const list = await candidates(f, item.id);
    expect(list.map((c) => c.moneyLineId)).toEqual([fitting.lineId, smaller.lineId, hinted.lineId, donation.lineId]);
    expect(list[0]).toMatchObject({ entryId: fitting.entry.id, entryNumber: fitting.entry.number, entryDate: '2026-02-14', accountId: f.bank.id, lineCents: 6000, freeCents: 6000, amountFits: true, categoryFits: true, blockedBy: null, purposeHint: null, payerContactId: f.member.id, viaGuardian: false, categoryIds: [f.feeCategory.id], assignedTo: [] });
    expect(list[1]).toMatchObject({ amountFits: false, blockedBy: null });
    expect(list[2]).toMatchObject({ purpose: 'Beitrag 2027', purposeHint: { kind: 'otherYear', year: '2027' }, blockedBy: null });
    expect(list[3]).toMatchObject({ categoryFits: false, blockedBy: 'assignCategoryMismatch' });
  });

  it('counts what is already settled at the line and leaves out a payment with nothing free', async () => {
    const f = await assignFixture();
    const item = f.feeItem();
    const other = f.feeItem({ paymentReference: 'MB-0008-2026' });
    const third = f.feeItem({ paymentReference: 'MB-0009-2026' });
    const partly = await f.pay({ cents: 8000, date: '2026-02-14', settlements: [{ openItemId: other.id, amountCents: 6000 }] });
    await f.pay({ cents: 6000, date: '2026-02-15', settlements: [{ openItemId: third.id, amountCents: 6000 }] });
    const list = await candidates(f, item.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ moneyLineId: partly.lineId, lineCents: 8000, freeCents: 2000, assignedTo: [{ openItemId: other.id, paymentReference: 'MB-0008-2026', contactId: f.member.id, amountCents: 6000 }] });
  });

  it('takes the purpose of the bank transaction and hints at the reference of another item of the contact', async () => {
    const f = await assignFixture();
    const item = f.feeItem();
    f.feeItem({ paymentReference: 'MB-0007-2027', itemDate: '2026-04-01' });
    const elsewhere = await f.pay({ cents: 6000, date: '2026-02-14', purpose: 'Zahlung mb-0007-2027' });
    const plain = await f.pay({ cents: 6000, date: '2026-02-15', purpose: 'Mitgliedsbeitrag 2026 MB-0007-2026' });
    const list = await candidates(f, item.id);
    expect(list.find((c) => c.moneyLineId === elsewhere.lineId)).toMatchObject({ purpose: 'Zahlung mb-0007-2027', purposeHint: { kind: 'otherItem', paymentReference: 'MB-0007-2027' } });
    expect(list.find((c) => c.moneyLineId === plain.lineId)).toMatchObject({ purposeHint: null });
  });

  it('a guardian pays: before the cut-off a candidate via guardian, after it none; her donation stays blocked', async () => {
    const f = await assignFixture();
    const item = f.feeItem({ originId: 'MINOR' });
    const before = await f.pay({ cents: 6000, date: '2026-03-02', contactId: f.guardian.id });
    await f.pay({ cents: 6000, date: '2026-08-01', contactId: f.guardian.id });
    const donation = await f.pay({ cents: 2500, date: '2026-03-02', contactId: f.guardian.id, categoryKey: 'donations' });
    const list = await candidates(f, item.id);
    expect(list.map((c) => c.moneyLineId)).toEqual([before.lineId, donation.lineId]);
    expect(list[0]).toMatchObject({ payerContactId: f.guardian.id, viaGuardian: true, blockedBy: null });
    expect(list[1]).toMatchObject({ viaGuardian: true, blockedBy: 'assignCategoryMismatch' });
  });

  it('a guardian payment is no candidate for an item without the hook', async () => {
    const f = await assignFixture();
    const item = f.feeItem();
    await f.pay({ cents: 6000, date: '2026-03-02', contactId: f.guardian.id });
    expect(await candidates(f, item.id)).toEqual([]);
  });

  it('needs finance.read and an item id', async () => {
    const f = await assignFixture();
    const item = f.feeItem();
    const denied = await listAssignablePayments(f.deps, { ...f.ctx, permissions: new Set() }, { openItemId: item.id });
    expect(denied.ok ? null : denied.error.type).toBe('forbidden');
    const invalid = await listAssignablePayments(f.deps, f.ctx, {});
    expect(invalid.ok ? null : invalid.error.type).toBe('validation');
  });
});

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const assign = (f: Awaited<ReturnType<typeof assignFixture>>, input: Record<string, unknown>, ctx = f.ctx) => assignPaymentToOpenItem(f.deps, ctx, input);
const auditOf = (f: Awaited<ReturnType<typeof assignFixture>>, action: string) =>
  f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action)).all().map((e) => ({ ...e, params: e.params ? (JSON.parse(e.params) as Record<string, unknown>) : null }));

describe('assignPaymentToOpenItem (Spec Zahlung zuordnen § 3.2)', () => {
  it('settles the item fully, or partly with a smaller amount; the entry stays as it is', async () => {
    const f = await assignFixture();
    const item = f.feeItem();
    const pay = await f.pay({ cents: 6000, date: '2026-02-14' });
    const before = entryViewInternal(f.deps.db, pay.entry.id);
    expect(unwrap(await assign(f, { openItemId: item.id, moneyLineId: pay.lineId }))).toMatchObject({ state: 'settled', openCents: 0, settledCents: 6000 });
    expect(entryViewInternal(f.deps.db, pay.entry.id)?.status).toBe(before?.status);
    expect(entryViewInternal(f.deps.db, pay.entry.id)?.allocationLines).toEqual(before?.allocationLines);
    const second = f.feeItem({ paymentReference: 'MB-0008-2026' });
    const small = await f.pay({ cents: 6000, date: '2026-02-15' });
    expect(unwrap(await assign(f, { openItemId: second.id, moneyLineId: small.lineId, amountCents: 2500 }))).toMatchObject({ state: 'open', openCents: 3500, settledCents: 2500 });
  });

  it('without an amount takes the smaller of the open rest and the free rest of the line', async () => {
    const f = await assignFixture();
    const item = f.feeItem();
    const pay = await f.pay({ cents: 3000, date: '2026-02-14' });
    expect(unwrap(await assign(f, { openItemId: item.id, moneyLineId: pay.lineId }))).toMatchObject({ openCents: 3000, settledCents: 3000 });
  });

  it('needs finance.entriesWrite; validates; protocols number and amount, never a contact', async () => {
    const f = await assignFixture();
    const item = f.feeItem();
    const pay = await f.pay({ cents: 6000, date: '2026-02-14' });
    expect(err(await assign(f, { openItemId: item.id, moneyLineId: pay.lineId }, { ...f.ctx, permissions: new Set(['finance.read']) }))).toMatchObject({ type: 'forbidden', permission: 'finance.entriesWrite' });
    expect(err(await assign(f, { openItemId: item.id }))).toMatchObject({ type: 'validation' });
    expect(err(await assign(f, { openItemId: item.id, moneyLineId: pay.lineId, amountCents: 0 }))).toMatchObject({ type: 'validation' });
    unwrap(await assign(f, { openItemId: item.id, moneyLineId: pay.lineId }));
    const [entry] = auditOf(f, 'finance.openItem.assignPayment');
    expect(entry).toMatchObject({ entityType: 'financeOpenItem', entityId: item.id, params: { entryNumber: pay.entry.number, amountCents: 6000 } });
    expect(JSON.stringify(entry)).not.toContain(f.member.id);
  });

  it('an agent may assign', async () => {
    const f = await assignFixture();
    const item = f.feeItem();
    const pay = await f.pay({ cents: 6000, date: '2026-02-14' });
    expect(err(await assign(f, { openItemId: item.id, moneyLineId: pay.lineId }, { ...f.ctx, channel: 'mcp' }))).toBe('ok');
  });

  it('R: only an open receivable, only by income', async () => {
    const f = await assignFixture();
    const pay = await f.pay({ cents: 6000, date: '2026-02-14' });
    const payable = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-03-01', amountCents: 6000, contactId: f.member.id }));
    expect(err(await assign(f, { openItemId: payable.id, moneyLineId: pay.lineId }))).toMatchObject({ code: 'settlementWrongDirection' });
    const cancelled = await f.plainItem();
    unwrap(await cancelOpenItem(f.deps, f.ctx, { id: cancelled.id, note: 'falsch' }));
    expect(err(await assign(f, { openItemId: cancelled.id, moneyLineId: pay.lineId }))).toMatchObject({ code: 'openItemCancelled' });
    const settled = f.feeItem();
    unwrap(await assign(f, { openItemId: settled.id, moneyLineId: pay.lineId }));
    const more = await f.pay({ cents: 6000, date: '2026-02-15' });
    expect(err(await assign(f, { openItemId: settled.id, moneyLineId: more.lineId }))).toMatchObject({ code: 'openItemNotOpen' });
    const refund = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-16', text: 'Erstattung', moneyLines: [{ accountId: f.bank.id, amountCents: -1000 }], allocationLines: [{ categoryId: f.feeCategory.id, amountCents: -1000, contactId: f.member.id }] }));
    const refundLine = entryViewInternal(f.deps.db, refund.id)!.moneyLines[0]!.id;
    expect(err(await assign(f, { openItemId: f.feeItem().id, moneyLineId: refundLine }))).toMatchObject({ code: 'settlementWrongDirection' });
  });

  it('F: a draft, a reversed entry and a reversal are refused', async () => {
    const f = await assignFixture();
    const item = f.feeItem();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-02-14', text: 'Beitrag', moneyLines: [{ accountId: f.bank.id, amountCents: 6000 }], allocationLines: [{ categoryId: f.feeCategory.id, amountCents: 6000, contactId: f.member.id }] }));
    expect(err(await assign(f, { openItemId: item.id, moneyLineId: draft.moneyLines[0]!.id }))).toMatchObject({ code: 'assignEntryNotFinal' });
    const pay = await f.pay({ cents: 6000, date: '2026-02-14' });
    const { reversal } = unwrap(await reverseEntry(f.deps, f.ctx, { id: pay.entry.id }));
    expect(err(await assign(f, { openItemId: item.id, moneyLineId: pay.lineId }))).toMatchObject({ code: 'assignEntryNotFinal' });
    expect(err(await assign(f, { openItemId: item.id, moneyLineId: entryViewInternal(f.deps.db, reversal.id)!.moneyLines[0]!.id }))).toMatchObject({ code: 'settlementWrongDirection' });
  });

  it('C: someone else paid — refused, the remedy names § 267 BGB', async () => {
    const f = await assignFixture();
    const item = f.feeItem();
    const other = await f.pay({ cents: 6000, date: '2026-02-14', contactId: f.wrongDonor.id });
    expect(err(await assign(f, { openItemId: item.id, moneyLineId: other.lineId }))).toMatchObject({ code: 'assignContactMismatch' });
    const guardian = await f.pay({ cents: 6000, date: '2026-02-14', contactId: f.guardian.id });
    expect(err(await assign(f, { openItemId: item.id, moneyLineId: guardian.lineId }))).toMatchObject({ code: 'assignContactMismatch' });
    const minor = f.feeItem({ originId: 'MINOR' });
    expect(err(await assign(f, { openItemId: minor.id, moneyLineId: guardian.lineId }))).toBe('ok');
    const late = await f.pay({ cents: 6000, date: '2026-08-01', contactId: f.guardian.id });
    expect(err(await assign(f, { openItemId: f.feeItem({ originId: 'MINOR' }).id, moneyLineId: late.lineId }))).toMatchObject({ code: 'assignContactMismatch' });
  });

  it('K: with a template every line needs its category; without one no gift kind', async () => {
    const f = await assignFixture();
    const donation = await f.pay({ cents: 6000, date: '2026-02-14', categoryKey: 'donations' });
    expect(err(await assign(f, { openItemId: f.feeItem().id, moneyLineId: donation.lineId }))).toMatchObject({ code: 'assignCategoryMismatch' });
    const sale = await f.pay({ cents: 6000, date: '2026-02-14', categoryKey: 'purpose-income' });
    expect(err(await assign(f, { openItemId: f.feeItem().id, moneyLineId: sale.lineId }))).toMatchObject({ code: 'assignCategoryNotTemplate' });
    const plain = await f.plainItem();
    expect(err(await assign(f, { openItemId: plain.id, moneyLineId: donation.lineId }))).toMatchObject({ code: 'assignCategoryMismatch' });
    expect(err(await assign(f, { openItemId: plain.id, moneyLineId: sale.lineId }))).toBe('ok');
  });

  it('Z: a gift in a valid confirmation is refused', async () => {
    const f = await assignFixture();
    const pledge = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 6000, contactId: f.member.id, lineTemplate: [{ categoryId: f.donations.id, contactId: f.member.id }] }));
    const gift = await f.pay({ cents: 6000, date: '2026-02-14', categoryKey: 'donations' });
    const giftLine = entryViewInternal(f.deps.db, gift.entry.id)!.allocationLines[0]!.id;
    f.deps.db.run(sql`PRAGMA foreign_keys = OFF`);
    f.deps.db.insert(financeConfirmationLines).values({ id: 'CL', confirmationId: 'C', lineId: giftLine, amountCents: 6000 }).run();
    f.deps.db.run(sql`PRAGMA foreign_keys = ON`);
    expect(err(await assign(f, { openItemId: pledge.id, moneyLineId: gift.lineId }))).toMatchObject({ code: 'assignPaymentConfirmed' });
  });

  it('B: at most the open rest and at most the free rest of the line', async () => {
    const f = await assignFixture();
    const item = f.feeItem();
    const big = await f.pay({ cents: 8000, date: '2026-02-14' });
    expect(err(await assign(f, { openItemId: item.id, moneyLineId: big.lineId, amountCents: 6001 }))).toMatchObject({ code: 'assignExceedsOpen', params: { open: 6000 } });
    const small = await f.pay({ cents: 3000, date: '2026-02-14' });
    expect(err(await assign(f, { openItemId: item.id, moneyLineId: small.lineId, amountCents: 3001 }))).toMatchObject({ code: 'assignExceedsLine', params: { free: 3000 } });
    expect(err(await assign(f, { openItemId: item.id, moneyLineId: small.lineId, amountCents: 3000 }))).toBe('ok');
  });

  it('one payment of 120 € settles two fees of 60 €; a third assignment finds nothing free', async () => {
    const f = await assignFixture();
    const a = f.feeItem();
    const b = f.feeItem({ paymentReference: 'MB-0007-2027' });
    const c = f.feeItem({ paymentReference: 'MB-0007-2028' });
    const pay = await f.pay({ cents: 12000, date: '2026-02-14' });
    expect(unwrap(await assign(f, { openItemId: a.id, moneyLineId: pay.lineId }))).toMatchObject({ state: 'settled' });
    expect(unwrap(await assign(f, { openItemId: b.id, moneyLineId: pay.lineId }))).toMatchObject({ state: 'settled' });
    expect(err(await assign(f, { openItemId: c.id, moneyLineId: pay.lineId, amountCents: 100 }))).toMatchObject({ code: 'assignExceedsLine', params: { free: 0 } });
  });

  it('two quick assignments together never take more than the free rest', async () => {
    const f = await assignFixture();
    const a = f.feeItem();
    const b = f.feeItem({ paymentReference: 'MB-0007-2027' });
    const pay = await f.pay({ cents: 6000, date: '2026-02-14' });
    const [first, second] = await Promise.all([assign(f, { openItemId: a.id, moneyLineId: pay.lineId, amountCents: 4000 }), assign(f, { openItemId: b.id, moneyLineId: pay.lineId, amountCents: 4000 })]);
    expect(err(first)).toBe('ok');
    expect(err(second)).toMatchObject({ code: 'assignExceedsLine' });
  });

  it('a purpose hint does not refuse', async () => {
    const f = await assignFixture();
    const item = f.feeItem();
    const pay = await f.pay({ cents: 6000, date: '2026-02-14', purpose: 'Beitrag 2027' });
    expect(err(await assign(f, { openItemId: item.id, moneyLineId: pay.lineId }))).toBe('ok');
  });

  it('L: an item in a direct debit with a file is refused', async () => {
    const f = await directDebitFixture();
    unwrap(await createFirstFiscalYear(f.deps, f.ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
    const a = await f.payer('Beispiel');
    const item = await f.fee(a, 1200, '2026-10-30');
    f.announce(a.mandateId, [{ dueOn: '2026-10-30', amountCents: 1200 }]);
    const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: run.id }));
    const fees = f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'membership-fees')).get()!;
    const pay = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-10-02', text: 'Beitrag', moneyLines: [{ accountId: f.bank.id, amountCents: 1200 }], allocationLines: [{ categoryId: fees.id, amountCents: 1200, contactId: a.contactId }] }));
    expect(err(await assignPaymentToOpenItem(f.deps, f.ctx, { openItemId: item, moneyLineId: pay.moneyLines[0]!.id }))).toMatchObject({ code: 'assignInDirectDebit', params: { runId: run.id, status: 'fileCreated' } });
  });

  it('J: refused when the later of the two days lies in a closed year, in either order', async () => {
    const f = await assignFixture();
    const oldItem = f.feeItem({ itemDate: '2025-11-01' });
    const oldPay = await f.pay({ cents: 6000, date: '2025-12-10' });
    const latePay = await f.pay({ cents: 6000, date: '2026-01-15' });
    const newItem = f.feeItem({ itemDate: '2026-03-01', paymentReference: 'MB-0008-2026' });
    f.closeYear(f.years['2025']!.id);
    expect(err(await assign(f, { openItemId: oldItem.id, moneyLineId: oldPay.lineId }))).toMatchObject({ code: 'fiscalYearClosed', params: { year: '2025' } });
    expect(err(await assign(f, { openItemId: newItem.id, moneyLineId: oldPay.lineId }))).toBe('ok');
    expect(err(await assign(f, { openItemId: oldItem.id, moneyLineId: latePay.lineId }))).toBe('ok');
  });

  it('the asset overview of a cut-off day counts the assignment from the later day', async () => {
    const f = await assignFixture();
    const decemberPay = await f.pay({ cents: 6000, date: '2025-12-10' });
    const marchItem = f.feeItem({ itemDate: '2026-03-01' });
    const atYearEnd = openItemsAtInternal(f.deps.db, '2025-12-31');
    unwrap(await assign(f, { openItemId: marchItem.id, moneyLineId: decemberPay.lineId }));
    expect(openItemsAtInternal(f.deps.db, '2025-12-31')).toEqual(atYearEnd);

    const novemberItem = f.feeItem({ itemDate: '2025-11-01', paymentReference: 'MB-0007-2025' });
    const januaryPay = await f.pay({ cents: 6000, date: '2026-01-15' });
    unwrap(await assign(f, { openItemId: novemberItem.id, moneyLineId: januaryPay.lineId }));
    expect(openItemsAtInternal(f.deps.db, '2025-12-31')).toContainEqual({ id: novemberItem.id, kind: 'receivable', openCents: 6000 });
    expect(openItemsAtInternal(f.deps.db, '2026-01-31').find((r) => r.id === novemberItem.id)).toBeUndefined();
  });
});
