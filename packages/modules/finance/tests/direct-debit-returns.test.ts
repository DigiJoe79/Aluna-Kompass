import { fixedClock, schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getMandate } from '../src/direct-debit/mandates';
import { getPledge } from '../src/direct-debit/pledges';
import { listDirectDebitReturns, resolveDirectDebitReturn } from '../src/direct-debit/returns';
import { createDirectDebitRun, getDirectDebitRun, listDirectDebitRuns, previewDirectDebitRun } from '../src/direct-debit/runs';
import { openCentsInternal } from '../src/ledger/open-items';
import { bookEntry } from '../src/ledger/finalize';
import { financeAccounts, financeDirectDebitReturns, financeOpenItems, financePledgeRateMarks, financeSepaMandates } from '../src/schema';
import { bookAndFinalize, creditScene, suggest } from './direct-debit-credit-fixture';

// Plan L3 Task 4 (Handoff 2a § 1.3 13d, Nachtrag Phase 2): „Rückgabe klären“ mit drei Wegen. Uhr danach: 10.11.2026.
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);

/** Gutschrift gebucht, danach beide Posten zurückgegeben (Beitrag `AM04`, Rate `MD06`) und festgeschrieben. */
async function scene() {
  const f = await creditScene();
  const credit = f.raw(11200);
  await bookAndFinalize(f, credit, await suggest(f, credit));
  const feeBack = f.raw(-5000, { date: '2026-11-04', returnCode: 'AM04', endToEndId: f.itemOf('openItem').endToEndId });
  await bookAndFinalize(f, feeBack, await suggest(f, feeBack));
  const rateBack = f.raw(-6200, { date: '2026-11-04', returnCode: 'MD06', endToEndId: f.itemOf('pledge').endToEndId });
  await bookAndFinalize(f, rateBack, await suggest(f, rateBack));
  const later = { ...f.deps, clock: fixedClock('2026-11-10T08:00:00.000Z') };
  const caseOf = (source: 'openItem' | 'pledge') => f.deps.db.select().from(financeDirectDebitReturns).where(eq(financeDirectDebitReturns.itemId, f.itemOf(source).id)).get()!;
  const resolve = (source: 'openItem' | 'pledge', resolution: 'recollect' | 'requestTransfer' | 'waive' | 'alreadyPaid', endMandate = false, ctx = f.ctx, confirmedAfterObjection = false) =>
    resolveDirectDebitReturn(later, ctx, { returnId: caseOf(source).id, resolution, endMandate, confirmedAfterObjection });
  const preview = async () => unwrap(await previewDirectDebitRun(later, f.ctx, { collectionDate: '2026-11-16' }));
  const included = async () => (await preview()).included.map((i) => i.source);
  const late = async () => ((await preview()).excluded.find((g) => g.reason === 'noticeLate')?.items ?? []).map((i) => i.source);
  const rate = async () => unwrap(await getPledge(later, f.ctx, { id: f.pledge.id, from: '2026-10-01', to: '2026-10-31' })).rates[0]!;
  return { ...f, later, caseOf, resolve, included, late, rate };
}

describe('resolveDirectDebitReturn — a fee', () => {
  it('before it is resolved, Kompass never collects again on its own', async () => {
    const f = await scene();
    expect(openCentsInternal(f.deps.db, f.feeId)).toBe(5000);
    expect(await f.included()).toEqual([]);
    expect(await f.late()).toEqual([]);
  });

  it('recollect: the item stays open and is in the next run once a new notice covers the day', async () => {
    const f = await scene();
    const resolved = unwrap(await f.resolve('openItem', 'recollect'));
    expect(resolved).toMatchObject({ status: 'resolved', resolution: 'recollect', mandateEnded: false, returnCode: 'AM04' });
    expect(f.caseOf('openItem')).toMatchObject({ status: 'resolved', resolution: 'recollect', resolvedAt: '2026-11-10T08:00:00.000Z', resolvedByUserId: f.userId });
    expect(await f.late()).toEqual(['openItem']);
    // Die Vorschau nennt den Tag, den die neue Ankündigung nennen muss, und ab wann eine heutige deckt.
    const preview = unwrap(await previewDirectDebitRun(f.later, f.ctx, { collectionDate: '2026-11-16' }));
    expect(preview.excluded.find((g) => g.reason === 'noticeLate')!.items[0]).toMatchObject({ coverOn: '2026-11-16' });
    expect(preview.noticeCoversFrom).toBe('2026-11-24');
    f.announce(f.a.mandateId, [{ dueOn: '2026-11-16', amountCents: 5000 }], '2026-11-01');
    expect(await f.included()).toEqual(['openItem']);
    const audit = f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'finance.directDebit.returnResolve')).all();
    expect(audit.map((a) => JSON.parse(a.params!))).toEqual([{ resolution: 'recollect', returnCode: 'AM04' }]);
  });

  it('requestTransfer: the item stays open, but is no longer collected', async () => {
    const f = await scene();
    unwrap(await f.resolve('openItem', 'requestTransfer'));
    f.announce(f.a.mandateId, [{ dueOn: '2026-11-16', amountCents: 5000 }], '2026-11-01');
    expect(openCentsInternal(f.deps.db, f.feeId)).toBe(5000);
    expect(await f.included()).toEqual([]);
    expect(await f.late()).toEqual([]);
  });

  it('waive: the item is waived (cancelled), the case resolved', async () => {
    const f = await scene();
    unwrap(await f.resolve('openItem', 'waive'));
    expect(f.deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.id, f.feeId)).get()!.cancelledAt).not.toBeNull();
    expect(f.caseOf('openItem')).toMatchObject({ status: 'resolved', resolution: 'waive' });
  });
});

describe('resolveDirectDebitReturn — a rate', () => {
  it('returned until resolved; recollect keeps it returned (will be collected again), then in the next run', async () => {
    const f = await scene();
    expect(await f.rate()).toMatchObject({ state: 'returned' });
    unwrap(await f.resolve('pledge', 'recollect', false, f.ctx, true));
    expect(await f.rate()).toMatchObject({ state: 'returned', recollect: true });
    expect(await f.late()).toEqual(['pledge']);
    f.announce(f.b.mandateId, [{ dueOn: '2026-11-16', amountCents: 6200 }], '2026-11-01');
    expect(await f.included()).toEqual(['pledge']);
    unwrap(await createDirectDebitRun(f.later, f.ctx, { collectionDate: '2026-11-16' }));
    expect(await f.rate()).toMatchObject({ state: 'inRun' });
  });

  it('requestTransfer: expected again, by transfer — not collected', async () => {
    const f = await scene();
    unwrap(await f.resolve('pledge', 'requestTransfer'));
    expect(await f.rate()).toMatchObject({ state: 'expected', transfer: true });
    f.announce(f.b.mandateId, [{ dueOn: '2026-11-16', amountCents: 6200 }], '2026-11-01');
    expect(await f.included()).toEqual([]);
  });

  it('waive: the rate is skipped with the reason waivedAfterReturn; MD06 with endMandate ends the mandate (returned)', async () => {
    const f = await scene();
    unwrap(await f.resolve('pledge', 'waive', true));
    expect(await f.rate()).toMatchObject({ state: 'skipped' });
    expect(f.deps.db.select().from(financePledgeRateMarks).all()).toMatchObject([{ pledgeId: f.pledge.id, dueOn: '2026-10-30', mark: 'skipped', reason: 'waivedAfterReturn' }]);
    expect(f.deps.db.select().from(financeSepaMandates).where(eq(financeSepaMandates.id, f.b.mandateId)).get()).toMatchObject({ endedOn: '2026-11-10', endReason: 'returned' });
    expect(f.caseOf('pledge')).toMatchObject({ status: 'resolved', resolution: 'waive', mandateEnded: true });
  });
});

describe('resolveDirectDebitReturn — refusals', () => {
  it('recollect with endMandate is refused; a resolved case cannot be resolved again', async () => {
    const f = await scene();
    expect(fail(await f.resolve('pledge', 'recollect', true))).toMatchObject({ code: 'recollectNeedsMandate' });
    unwrap(await f.resolve('pledge', 'requestTransfer'));
    expect(fail(await f.resolve('pledge', 'waive'))).toMatchObject({ code: 'returnResolved' });
  });

  it('recollect after an objection (MD06, MD01, AC04) needs the confirmation that the payer was asked (M38)', async () => {
    const f = await scene();
    expect(fail(await f.resolve('pledge', 'recollect'))).toMatchObject({ type: 'conflict', code: 'recollectNeedsConfirmation', params: { returnCode: 'MD06' } });
    expect(f.caseOf('pledge').status).toBe('open');
    expect(unwrap(await f.resolve('pledge', 'recollect', false, f.ctx, true))).toMatchObject({ resolution: 'recollect' });
  });

  it('recollect for a fee that is paid meanwhile is refused with nothingOpen (M38)', async () => {
    const f = await scene();
    const bank = f.deps.db.select().from(financeAccounts).where(eq(financeAccounts.isMain, true)).get()!;
    unwrap(await bookEntry(f.later, f.ctx, { entryDate: '2026-11-08', text: 'Beitrag per Überweisung', moneyLines: [{ accountId: bank.id, amountCents: 5000, settlements: [{ openItemId: f.feeId, amountCents: 5000 }] }], allocationLines: [{ categoryId: f.membership, amountCents: 5000 }] }));
    expect(openCentsInternal(f.deps.db, f.feeId)).toBe(0);
    expect(fail(await f.resolve('openItem', 'recollect'))).toMatchObject({ type: 'conflict', code: 'nothingOpen' });
    expect(unwrap(await f.resolve('openItem', 'requestTransfer'))).toMatchObject({ resolution: 'requestTransfer' });
  });

  it('a fee paid meanwhile: alreadyPaid closes the return, waive answers nothingOpen, the list says it is paid (U4)', async () => {
    const f = await scene();
    expect(fail(await f.resolve('openItem', 'alreadyPaid'))).toMatchObject({ type: 'conflict', code: 'notPaidOtherwise' });
    expect(fail(await f.resolve('pledge', 'alreadyPaid'))).toMatchObject({ type: 'conflict', code: 'notPaidOtherwise' });
    expect(unwrap(await listDirectDebitReturns(f.later, f.ctx, { status: 'open' })).items.map((r) => [r.source, r.itemPaid])).toEqual(expect.arrayContaining([['openItem', false], ['pledge', false]]));
    const bank = f.deps.db.select().from(financeAccounts).where(eq(financeAccounts.isMain, true)).get()!;
    unwrap(await bookEntry(f.later, f.ctx, { entryDate: '2026-11-08', text: 'Beitrag per Überweisung', moneyLines: [{ accountId: bank.id, amountCents: 5000, settlements: [{ openItemId: f.feeId, amountCents: 5000 }] }], allocationLines: [{ categoryId: f.membership, amountCents: 5000 }] }));
    expect(unwrap(await listDirectDebitReturns(f.later, f.ctx, { status: 'open' })).items.find((r) => r.source === 'openItem')).toMatchObject({ itemPaid: true });
    expect(fail(await f.resolve('openItem', 'waive'))).toMatchObject({ type: 'conflict', code: 'nothingOpen' });
    expect(f.deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.id, f.feeId)).get()!.cancelledAt).toBeNull();
    expect(unwrap(await f.resolve('openItem', 'alreadyPaid'))).toMatchObject({ status: 'resolved', resolution: 'alreadyPaid' });
    const audit = f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'finance.directDebit.returnResolve').at(-1)!;
    expect(JSON.parse(audit.params!)).toMatchObject({ resolution: 'alreadyPaid', returnCode: 'AM04' });
  });

  it('needs finance.directDebit, a known case and a valid way', async () => {
    const f = await scene();
    expect(fail(await f.resolve('openItem', 'waive', false, ctxWith(['finance.read'], f.userId)))).toMatchObject({ type: 'forbidden' });
    expect(fail(await resolveDirectDebitReturn(f.later, f.ctx, { returnId: 'NOPE', resolution: 'waive', endMandate: false }))).toMatchObject({ type: 'notFound' });
    expect(fail(await resolveDirectDebitReturn(f.later, f.ctx, { returnId: f.caseOf('openItem').id, resolution: 'later', endMandate: false }))).toMatchObject({ type: 'validation' });
  });
});

describe('listDirectDebitReturns', () => {
  it('lists open and resolved returns, newest first, with the code and whether ending the mandate is suggested', async () => {
    const f = await scene();
    unwrap(await f.resolve('openItem', 'requestTransfer'));
    const open = unwrap(await listDirectDebitReturns(f.later, f.ctx, { status: 'open' }));
    expect(open).toMatchObject({ total: 1, items: [{ source: 'pledge', returnCode: 'MD06', suggestEndMandate: true, status: 'open', amountCents: 6200, collectionDate: '2026-10-30', mandateReference: f.itemOf('pledge').mandateReference }] });
    expect(unwrap(await listDirectDebitReturns(f.later, f.ctx, {})).total).toBe(2);
    // Am Einzug: zwei Rückgaben, eine noch zu klären (Handoff 2a § 1.1).
    expect(unwrap(await listDirectDebitRuns(f.later, f.ctx, {})).items[0]).toMatchObject({ returns: 2, openReturns: 1 });
    // Einzug und Mandat lesen ihre Rückgaben über Filter; der Posten trägt seine Rückgabe, der Beitrag seine Herkunft.
    const byRun = unwrap(await listDirectDebitReturns(f.later, f.ctx, { runId: f.run.id }));
    expect(byRun.total).toBe(2);
    expect(byRun.items[0]).toMatchObject({ returnedOn: '2026-11-04', debtorName: expect.any(String) });
    expect(unwrap(await listDirectDebitReturns(f.later, f.ctx, { mandateId: f.itemOf('pledge').mandateId })).items.map((r) => r.source)).toContain('pledge');
    expect(unwrap(await listDirectDebitReturns(f.later, f.ctx, { runId: 'other' })).total).toBe(0);
    const run = unwrap(await getDirectDebitRun(f.later, f.ctx, { id: f.run.id }));
    expect(run.items.find((i) => i.source === 'pledge')).toMatchObject({ returnStatus: 'open', origin: null });
    // Die Rate nennt ihren Einzug und die offene Rückgabe; das Mandat seine Einzüge (Handoff 2a § 1.4, § 1.5).
    expect(await f.rate()).toMatchObject({ state: 'returned', run: { id: f.run.id, collectionDate: '2026-10-30' }, returnId: f.caseOf('pledge').id });
    expect(unwrap(await getMandate(f.later, f.ctx, { id: f.itemOf('pledge').mandateId })).collections).toMatchObject([{ runId: f.run.id, collectionDate: '2026-10-30', source: 'pledge' }]);
    expect(fail(await listDirectDebitReturns(f.later, ctxWith([], f.userId), {}))).toMatchObject({ type: 'forbidden' });
  });
});
