import { newId, unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { documents, documentSnippets } from '@kompass/module-dms';
import {
  createAccount,
  FINANCE_PERMISSIONS,
  financeAccounts,
  financeDirectDebitItems,
  financeDirectDebitRuns,
  financeDirectDebitReturns,
  financeImportRuns,
  financeRawTransactions,
  financeSepaMandates,
} from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { continueDunningRun, getDunningRun, listDunningRuns, previewDunningRun, reachedLevel, startDunningRun } from '../src/dunning';
import { setFeeAgreement } from '../src/fee-agreement';
import { deferCharge, listFees, waiveCharge } from '../src/fees';
import { continueFeeRun, startFeeRun } from '../src/fee-run';
import { admitMember } from '../src/memberships';
import { markRunPostDispatched } from '../src/run-dispatch';
import { memberDunningNotices, memberDunningRuns, memberFeeCharges } from '../src/schema';
import { addressedPerson, asMcp, auditOf, enteredOn, MEMBERS_PERMISSIONS, payOpenItem, setupFees, type MembersDeps } from './helpers';

const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);
const PERMS = [...MEMBERS_PERMISSIONS, 'dms.view', 'dms.create', 'dms.send', ...FINANCE_PERMISSIONS];

/**
 * Ein ordentliches Mitglied seit 01.01.2026, Jahresbeitrag 12,00 € fällig am 01.01.2026, Briefe per Post. Der Beitrag
 * gilt als am 01.12.2025 angelegt (wie aus dem Beitragslauf), außer mit `retroactive` — dann trägt er den Tag der Aufnahme.
 */
async function setup(now = '2026-01-20T08:00:00.000Z', opts: { retroactive?: boolean } = {}) {
  const env = await setupFees({ now, validFrom: '2026-01-01', permissions: PERMS });
  const { deps, ctx, types } = env;
  const contactId = await addressedPerson(deps, { lastName: 'Mahnfall' });
  const member = unwrap(await admitMember(deps, ctx, { contactId, typeId: types.regular, admittedOn: '2026-01-01' }));
  if (!opts.retroactive) enteredOn(deps, '2025-12-01');
  const charge = deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, member.id)).get()!;
  const at = (iso: string) => deps.clock.set(`${iso}T08:00:00.000Z`);
  return { ...env, contactId, member, charge, at };
}

/** Lauf starten und ganz abarbeiten; liefert die Lauf-ID. */
async function runAt(deps: MembersDeps, ctx: CallContext, asOf: string): Promise<string> {
  const run = unwrap(await startDunningRun(deps, ctx, { asOf }));
  unwrap(await continueDunningRun(deps, ctx, { runId: run.id, max: 50 }));
  return run.id;
}

/** Ein offener Kontoumsatz (ohne Buchung) — für „Zahlung könnte passen“. */
async function rawIncoming(deps: MembersDeps, o: { date: string; amountCents: number; name?: string; iban?: string }) {
  const ctx: CallContext = { ...systemContext(), permissions: new Set(FINANCE_PERMISSIONS) };
  const account = deps.db.select().from(financeAccounts).get() ?? unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
  const runId = newId();
  deps.db.insert(financeImportRuns).values({ id: runId, accountId: account.id, format: 'camt053', fileName: 'auszug.xml', fileSha256: runId.padEnd(64, '0'), fileKey: null, periodFrom: o.date, periodTo: o.date, closingCents: null, startedAt: `${o.date}T09:00:00.000Z`, finishedAt: `${o.date}T09:01:00.000Z`, createdByUserId: 'system', createdChannel: 'ui' }).run();
  deps.db
    .insert(financeRawTransactions)
    .values({ id: newId(), runId, accountId: account.id, bookingDate: o.date, valueDate: null, amountCents: o.amountCents, counterpartyName: o.name ?? 'Jemand Anderes', counterpartyIban: o.iban ?? 'DE66999999991234567890', purpose: 'Zahlung', bankReference: null, dedupKey: `k-${runId}`, lineIndex: 1, createdAt: `${o.date}T09:00:00.000Z` })
    .run();
}

describe('reachedLevel', () => {
  const order = ['reminder', 'dunning', 'finalDunning'];
  it('is the highest level whose letter is dispatched; a letter without dispatch (or not delivered) does not count', () => {
    const notices = [
      { levelKey: 'reminder', documentId: 'A' },
      { levelKey: 'dunning', documentId: 'B' },
    ];
    expect(reachedLevel(notices, (id) => (id === 'A' ? '2026-01-21' : null), order)).toEqual({ levelKey: 'reminder', sentOn: '2026-01-21' });
    expect(reachedLevel(notices, () => '2026-02-21', order)).toEqual({ levelKey: 'dunning', sentOn: '2026-02-21' });
    expect(reachedLevel(notices, () => null, order)).toBeNull();
    expect(reachedLevel([], () => '2026-01-01', order)).toBeNull();
  });
});

describe('Mahnlauf', () => {
  it('climbs the levels over three runs with dispatch in between, then stops at the last', async () => {
    const { deps, ctx, member, charge, at } = await setup();
    const preview = unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-01-20' }));
    expect(preview.ready).toEqual([expect.objectContaining({ membershipId: member.id, memberNumber: member.memberNumber, levelKey: 'reminder', chargeIds: [charge.id], sumCents: 1200 })]);

    const first = await runAt(deps, ctx, '2026-01-20');
    const notice = deps.db.select().from(memberDunningNotices).get()!;
    expect(notice).toMatchObject({ membershipId: member.id, levelKey: 'reminder', chargeIds: [charge.id], runId: first, issuedOn: '2026-01-20' });
    expect(deps.db.select().from(documents).where(eq(documents.id, notice.documentId)).get()).toMatchObject({ typeKey: 'member-reminder', subject: 'Mitgliedsbeitrag 2026 – Erinnerung' });
    // Ohne Versandvermerk zählt die Stufe nicht, und der nächste Lauf übergeht das Mitglied (Review Focus 2).
    at('2026-03-01');
    expect(unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-03-01' })).skipped).toEqual([expect.objectContaining({ membershipId: member.id, reason: 'previousNotSent' })]);
    expect(unwrap(await listFees(deps, ctx, { year: 2026 })).items[0]!.dunningLevel).toBeNull();
    unwrap(await markRunPostDispatched(deps, ctx, { runRef: `membersDunningRun:${first}`, sentAt: '2026-01-21' }));
    expect(unwrap(await listFees(deps, ctx, { year: 2026 })).items[0]!.dunningLevel).toBe('reminder');

    // Die nächste Stufe frühestens 28 Tage nach dem Versand der vorigen.
    at('2026-02-10');
    expect(unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-02-10' })).ready).toEqual([]);
    at('2026-02-20');
    const second = await runAt(deps, ctx, '2026-02-20');
    unwrap(await markRunPostDispatched(deps, ctx, { runRef: `membersDunningRun:${second}`, sentAt: '2026-02-20' }));
    at('2026-03-25');
    const third = await runAt(deps, ctx, '2026-03-25');
    expect(deps.db.select().from(memberDunningNotices).all().map((n) => n.levelKey)).toEqual(['reminder', 'dunning', 'finalDunning']);
    unwrap(await markRunPostDispatched(deps, ctx, { runRef: `membersDunningRun:${third}`, sentAt: '2026-03-25' }));
    expect(unwrap(await listFees(deps, ctx, { year: 2026 })).items[0]!.dunningLevel).toBe('finalDunning');

    at('2026-06-01');
    const after = unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-06-01' }));
    expect(after.ready).toEqual([]);
    expect(after.skipped).toEqual([expect.objectContaining({ membershipId: member.id, reason: 'lastLevelReached' })]);
    expect(fail(await startDunningRun(deps, ctx, { asOf: '2026-06-01' }))).toMatchObject({ type: 'conflict', code: 'dunningRunNothingReady' });
  });

  it('lists the runs and reads one with the letters still due', async () => {
    const { deps, ctx, at } = await setup();
    at('2026-02-20');
    const run = unwrap(await startDunningRun(deps, ctx, { asOf: '2026-02-20' }));
    expect(unwrap(await getDunningRun(deps, ctx, run.id))).toMatchObject({ status: 'running', issued: 0, remaining: 1 });
    unwrap(await continueDunningRun(deps, ctx, { runId: run.id, max: 50 }));
    expect(unwrap(await getDunningRun(deps, ctx, run.id))).toMatchObject({ status: 'done', issued: 1, remaining: 0 });
    expect(unwrap(await listDunningRuns(deps, ctx, {}))).toMatchObject({ total: 1, items: [{ id: run.id }] });
    expect(await listDunningRuns(deps, { ...ctx, permissions: new Set(['members.fees']) }, {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });

  it('the level text comes from the snippet of the level', async () => {
    const { deps, ctx } = await setup();
    await runAt(deps, ctx, '2026-01-20');
    const notice = deps.db.select().from(memberDunningNotices).get()!;
    const snippet = deps.db.select().from(documentSnippets).all().find((s) => s.name === 'Mahnstufe: Erinnerung')!;
    const input = JSON.parse(deps.db.select().from(documents).where(eq(documents.id, notice.documentId)).get()!.inputSnapshot!).input;
    expect(input.outro).toContain(snippet.body);
  });

  it('after full payment the level is gone and nothing is ripe', async () => {
    const { deps, ctx, charge, at } = await setup();
    const run = await runAt(deps, ctx, '2026-01-20');
    unwrap(await markRunPostDispatched(deps, ctx, { runRef: `membersDunningRun:${run}`, sentAt: '2026-01-20' }));
    at('2026-03-01');
    await payOpenItem(deps, charge.openItemId!, 1200, '2026-01-25');
    expect(unwrap(await listFees(deps, ctx, { year: 2026 })).items[0]).toMatchObject({ state: 'paid', dunningLevel: null });
    const preview = unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-03-01' }));
    expect([preview.ready, preview.skipped, preview.paymentMayMatch]).toEqual([[], [], []]);
  });

  it('a matching unassigned payment holds the letter for this member only (Review Focus 1)', async () => {
    const { deps, ctx, types, member } = await setup();
    const other = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps, { lastName: 'Zweitmitglied' }), typeId: types.regular, admittedOn: '2026-01-01' }));
    enteredOn(deps, '2025-12-01');
    await rawIncoming(deps, { date: '2026-01-18', amountCents: 1200 });
    let preview = unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-01-20' }));
    expect(preview.paymentMayMatch.map((p) => p.membershipId).sort()).toEqual([member.id, other.id].sort());
    expect(preview.ready).toEqual([]);

    // Ein Name passt nur zu einem Mitglied; ein Umsatz älter als 30 Tage zählt nicht.
    const f2 = await setup();
    await rawIncoming(f2.deps, { date: '2026-01-19', amountCents: 500, name: 'ERIKA MAHNFALL' });
    await rawIncoming(f2.deps, { date: '2025-12-01', amountCents: 1200 });
    preview = unwrap(await previewDunningRun(f2.deps, f2.ctx, { asOf: '2026-01-20' }));
    expect(preview.paymentMayMatch).toEqual([expect.objectContaining({ membershipId: f2.member.id, rawTransactionIds: [expect.any(String)] })]);
    // Der Lauf übergeht das Mitglied, er bricht nicht ab.
    unwrap(await admitMember(f2.deps, f2.ctx, { contactId: await addressedPerson(f2.deps, { lastName: 'Ohnezahlung' }), typeId: f2.types.regular, admittedOn: '2026-01-01' }));
    enteredOn(f2.deps, '2025-12-01');
    await runAt(f2.deps, f2.ctx, '2026-01-20');
    expect(f2.deps.db.select().from(memberDunningNotices).all().map((n) => n.membershipId)).not.toContain(f2.member.id);
    expect(f2.deps.db.select().from(memberDunningNotices).all()).toHaveLength(1);
  });

  it('a fee entered in time counts its first level from the due date, as before', async () => {
    const { deps, ctx, member } = await setup('2026-01-14T08:00:00.000Z');
    expect(unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-01-14' })).ready).toEqual([]);
    expect(unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-01-15' })).ready).toEqual([expect.objectContaining({ membershipId: member.id, levelKey: 'reminder' })]);
  });

  it('a fee entered after its due date counts its first level from entry plus the payment term (Befund 2026-10-18)', async () => {
    // Aufnahme am 20.01. rückwirkend zum 01.01.: Der Brief nennt als Frist 03.02. (20.01. + 14 Tage), die Erinnerung
    // folgt frühestens 14 Tage danach — nicht schon am Tag der Erfassung.
    const { deps, ctx, member } = await setup('2026-01-20T08:00:00.000Z', { retroactive: true });
    const empty = { ready: [], paymentMayMatch: [], skipped: [] };
    expect(unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-01-20' }))).toMatchObject(empty);
    expect(unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-02-16' }))).toMatchObject(empty);
    expect(unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-02-17' })).ready).toEqual([expect.objectContaining({ membershipId: member.id, levelKey: 'reminder' })]);
    // Ein längeres Zahlungsziel schiebt die Erinnerung mit.
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'members.paymentTermDays', 21));
    expect(unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-02-23' })).ready).toEqual([]);
    expect(unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-02-24' })).ready).toHaveLength(1);
  });

  it('a deferred fee waits until after the new due date plus the period (Review Focus 4)', async () => {
    const { deps, ctx, charge, member, at } = await setup('2026-01-10T08:00:00.000Z');
    unwrap(await deferCharge(deps, ctx, { chargeId: charge.id, dueOn: '2026-02-15' }));
    at('2026-02-20');
    const preview = unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-02-20' }));
    expect(preview.ready).toEqual([]);
    expect(preview.skipped).toEqual([expect.objectContaining({ membershipId: member.id, reason: 'deferred' })]);
    at('2026-03-01');
    expect(unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-03-01' })).ready).toEqual([expect.objectContaining({ membershipId: member.id, levelKey: 'reminder' })]);
  });

  it('a mandate only prepared (pending) is no way of payment: the fee is dunned like a transfer, with the transfer block', async () => {
    const { deps, ctx, member, charge } = await setup();
    unwrap(await setFeeAgreement(deps, ctx, { membershipId: member.id, validFrom: '2026-01-01', paymentMethod: 'directDebit', iban: 'DE44999999990532013000', debtorName: 'Erika Mahnfall' }));
    const preview = unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-01-20' }));
    expect(preview.skipped).toEqual([]);
    expect(preview.ready).toEqual([expect.objectContaining({ membershipId: member.id, levelKey: 'reminder', returnedOn: null })]);
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'organization.iban', 'DE23999999990000202051'));
    await runAt(deps, ctx, '2026-01-20');
    const notice = deps.db.select().from(memberDunningNotices).get()!;
    expect(JSON.parse(deps.db.select().from(documents).where(eq(documents.id, notice.documentId)).get()!.inputSnapshot!).input.transfer).toMatchObject({ amount: '12,00\u00a0€' });
    void charge;
  });

  it('a direct debit payer gets no letter until a collection came back (Review Focus 5)', async () => {
    const { deps, ctx, member, charge } = await setup();
    const agreement = unwrap(await setFeeAgreement(deps, ctx, { membershipId: member.id, validFrom: '2026-01-01', paymentMethod: 'directDebit', iban: 'DE44999999990532013000', debtorName: 'Erika Mahnfall' }));
    deps.db.update(financeSepaMandates).set({ signedOn: '2026-01-01' }).where(eq(financeSepaMandates.id, agreement.mandateId!)).run();
    const live = deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, member.id)).all().find((c) => c.state === 'created')!;
    let preview = unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-01-20' }));
    expect(preview.ready).toEqual([]);
    expect(preview.skipped).toEqual([expect.objectContaining({ membershipId: member.id, reason: 'directDebit' })]);

    // Ein Einzug kam zurück: jetzt gemahnt, mit dem Satz zur Rückgabe.
    const now = '2026-01-12T08:00:00.000Z';
    const account = deps.db.select().from(financeAccounts).get() ?? unwrap(await createAccount(deps, { ...systemContext(), permissions: new Set(FINANCE_PERMISSIONS) }, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
    const runId = newId();
    deps.db.insert(financeDirectDebitRuns).values({ id: runId, collectionDate: '2026-01-10', accountId: account.id, status: 'submitted', messageId: 'MSG-1', submittedOn: '2026-01-07', createdByUserId: 'system', createdAt: now, updatedAt: now }).run();
    const itemId = newId();
    deps.db.insert(financeDirectDebitItems).values({ id: itemId, runId, mandateId: agreement.mandateId!, source: 'openItem', sourceId: live.openItemId!, installmentOn: null, amountCents: 1200, endToEndId: 'E2E-1', remittance: 'Beitrag', createdAt: now }).run();
    deps.db.insert(financeDirectDebitReturns).values({ id: newId(), itemId, rawTransactionId: 'RAW', entryId: 'ENTRY', returnCode: 'AM04', feeCents: 0, status: 'open', createdAt: now }).run();
    preview = unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-01-20' }));
    expect(preview.ready).toEqual([expect.objectContaining({ membershipId: member.id, returnedOn: '2026-01-10' })]);
    await runAt(deps, ctx, '2026-01-20');
    const notice = deps.db.select().from(memberDunningNotices).get()!;
    const input = JSON.parse(deps.db.select().from(documents).where(eq(documents.id, notice.documentId)).get()!.inputSnapshot!).input;
    expect(input.intro).toContain('die Lastschrift vom 10.01.2026 wurde von Ihrer Bank zurückgegeben.');
    void charge;
  });

  it('start and continue are human only, need members.fees; preview needs members.read; both audited', async () => {
    const { deps, ctx } = await setup();
    expect(fail(await previewDunningRun(deps, { ...ctx, permissions: new Set(['dms.view']) }, { asOf: '2026-01-20' }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await previewDunningRun(deps, ctx, { asOf: 'heute' }))).toMatchObject({ type: 'validation' });
    expect(fail(await startDunningRun(deps, asMcp(ctx), { asOf: '2026-01-20' }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    expect(fail(await startDunningRun(deps, { ...ctx, permissions: new Set(['members.read', 'members.manage']) }, { asOf: '2026-01-20' }))).toMatchObject({ type: 'forbidden' });
    const run = unwrap(await startDunningRun(deps, ctx, { asOf: '2026-01-20' }));
    expect(fail(await startDunningRun(deps, ctx, { asOf: '2026-01-20' }))).toMatchObject({ type: 'conflict', code: 'dunningRunRunning' });
    expect(fail(await continueDunningRun(deps, asMcp(ctx), { runId: run.id }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    const done = unwrap(await continueDunningRun(deps, ctx, { runId: run.id, max: 50 }));
    expect(done).toMatchObject({ status: 'done', issued: 1, refused: [] });
    expect(fail(await continueDunningRun(deps, ctx, { runId: run.id }))).toMatchObject({ type: 'conflict', code: 'dunningRunDone' });
    expect(auditOf(deps, 'members.dunningRun.start').at(-1)!.params).toEqual({ asOfOn: '2026-01-20', count: 1 });
    expect(auditOf(deps, 'members.dunningRun.finish').at(-1)!.params).toEqual({ asOfOn: '2026-01-20', count: 1 });
  });

  it('the closing audit counts the refusals of the whole run, not only those of the last section', async () => {
    const { deps, ctx } = await setup();
    const run = unwrap(await startDunningRun(deps, ctx, { asOf: '2026-01-20' }));
    deps.db.update(memberDunningRuns).set({ refused: [{ membershipId: 'EARLIER', code: 'earlierSection' }] }).where(eq(memberDunningRuns.id, run.id)).run();
    expect(unwrap(await continueDunningRun(deps, ctx, { runId: run.id, max: 50 }))).toMatchObject({ status: 'done', issued: 1 });
    expect(auditOf(deps, 'members.dunningRun.finish').at(-1)!.after).toContain('"refused":1');
  });

  it('runs only up to today; the preview may look ahead (R1)', async () => {
    const { deps, ctx, member } = await setup('2026-01-19T08:00:00.000Z');
    // Die Vorschau darf in die Zukunft schauen …
    expect(unwrap(await previewDunningRun(deps, ctx, { asOf: '2026-01-20' })).ready).toEqual([expect.objectContaining({ membershipId: member.id })]);
    // … der Lauf nicht: Er mahnte sonst vor Ablauf einer Frist, die das Mitglied genannt bekommen hat.
    expect(fail(await startDunningRun(deps, ctx, { asOf: '2026-01-20' }))).toMatchObject({ type: 'validation', issues: [{ path: 'asOf', message: 'inFuture' }] });
    expect(auditOf(deps, 'members.dunningRun.start')).toEqual([]);
    // Stichtag = heute geht.
    deps.clock.set('2026-01-20T08:00:00.000Z');
    expect(unwrap(await startDunningRun(deps, ctx, { asOf: '2026-01-20' }))).toMatchObject({ asOf: '2026-01-20', status: 'running' });
  });
});

describe('Mahnstufe je Beitrag (Plan N1 E2, M44)', () => {
  /** 2026 erinnert und gemahnt (beides versandt), dann der Beitragslauf 2027 im Dezember. */
  async function twoYears() {
    const f = await setup();
    const first = await runAt(f.deps, f.ctx, '2026-01-20');
    f.at('2026-01-21');
    unwrap(await markRunPostDispatched(f.deps, f.ctx, { runRef: `membersDunningRun:${first}`, sentAt: '2026-01-21' }));
    f.at('2026-02-20');
    const second = await runAt(f.deps, f.ctx, '2026-02-20');
    unwrap(await markRunPostDispatched(f.deps, f.ctx, { runRef: `membersDunningRun:${second}`, sentAt: '2026-02-20' }));
    f.at('2026-12-01');
    const feeRun = unwrap(await startFeeRun(f.deps, f.ctx, { year: 2027 }));
    for (let view = feeRun; view.status === 'running'; ) view = unwrap(await continueFeeRun(f.deps, f.ctx, { runId: feeRun.id, max: 50 }));
    const next = f.deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, f.member.id)).all().find((c) => c.periodStart === '2027-01-01')!;
    f.at('2027-01-20');
    return { ...f, next };
  }

  it('(a) a member with fees on different levels gets one letter per level, each with its own fees (Review Focus 3)', async () => {
    const f = await twoYears();
    const preview = unwrap(await previewDunningRun(f.deps, f.ctx, { asOf: '2027-01-20' }));
    expect(preview.ready.map((c) => [c.levelKey, c.chargeIds])).toEqual([
      ['reminder', [f.next.id]],
      ['finalDunning', [f.charge.id]],
    ]);
    await runAt(f.deps, f.ctx, '2027-01-20');
    const notices = f.deps.db.select().from(memberDunningNotices).all().filter((n) => n.issuedOn === '2027-01-20');
    expect(notices.map((n) => [n.levelKey, n.chargeIds]).sort()).toEqual([['finalDunning', [f.charge.id]], ['reminder', [f.next.id]]].sort());
    expect(new Set(notices.map((n) => n.documentId)).size).toBe(2);
  });

  it('(c) a waived fee leaves the count; the other keeps its own level', async () => {
    const f = await twoYears();
    unwrap(await waiveCharge(f.deps, f.ctx, { chargeId: f.charge.id }));
    const preview = unwrap(await previewDunningRun(f.deps, f.ctx, { asOf: '2027-01-20' }));
    expect(preview.ready.map((c) => [c.levelKey, c.chargeIds])).toEqual([['reminder', [f.next.id]]]);
  });

  it('(b) after a deferral the count starts again: reminders before it do not count for this fee', async () => {
    const f = await setup();
    const first = await runAt(f.deps, f.ctx, '2026-01-20');
    f.at('2026-01-21');
    unwrap(await markRunPostDispatched(f.deps, f.ctx, { runRef: `membersDunningRun:${first}`, sentAt: '2026-01-21' }));
    f.at('2026-02-01');
    unwrap(await deferCharge(f.deps, f.ctx, { chargeId: f.charge.id, dueOn: '2026-03-31' }));
    f.at('2026-04-20');
    expect(unwrap(await previewDunningRun(f.deps, f.ctx, { asOf: '2026-04-20' })).ready).toEqual([expect.objectContaining({ levelKey: 'reminder', chargeIds: [f.charge.id] })]);
  });

  it('(c) after a deferral the fee shows no dunning level, the old one as dunningLevelBeforeDeferral (R17)', async () => {
    const f = await setup();
    const first = await runAt(f.deps, f.ctx, '2026-01-20');
    f.at('2026-01-21');
    unwrap(await markRunPostDispatched(f.deps, f.ctx, { runRef: `membersDunningRun:${first}`, sentAt: '2026-01-21' }));
    expect(unwrap(await listFees(f.deps, f.ctx, { year: 2026 })).items[0]).toMatchObject({ dunningLevel: 'reminder', dunningLevelBeforeDeferral: null });
    f.at('2026-02-01');
    unwrap(await deferCharge(f.deps, f.ctx, { chargeId: f.charge.id, dueOn: '2026-03-31' }));
    expect(unwrap(await listFees(f.deps, f.ctx, { year: 2026 })).items[0]).toMatchObject({ dunningLevel: null, dunningLevelBeforeDeferral: 'reminder' });
  });

  it('(c2) a payment saved as a draft keeps the member visible: skipped with paymentDraft (R6)', async () => {
    const f = await setup();
    await payOpenItem(f.deps, f.charge.openItemId!, 1200, '2026-01-18', { draft: true });
    expect(unwrap(await previewDunningRun(f.deps, f.ctx, { asOf: '2026-01-20' }))).toMatchObject({ ready: [], paymentMayMatch: [], skipped: [expect.objectContaining({ membershipId: f.member.id, reason: 'paymentDraft' })] });
  });

  it('(d) start says that members wait for a payment to be assigned, with their number (M43)', async () => {
    const f = await setup();
    await rawIncoming(f.deps, { date: '2026-01-18', amountCents: 1200 });
    expect(fail(await startDunningRun(f.deps, f.ctx, { asOf: '2026-01-20' }))).toMatchObject({ type: 'conflict', code: 'dunningRunWaitingForMatch', params: { count: 1 } });
  });

  it('(e) a direct debit fee is listed under skipped by the day asked for, also when the member has another fee ready (M20)', async () => {
    const f = await setup('2026-01-10T08:00:00.000Z');
    const contactId = await addressedPerson(f.deps, { lastName: 'Gemischt' });
    const member = unwrap(await admitMember(f.deps, f.ctx, { contactId, typeId: f.types.supporting, admittedOn: '2026-01-01' }));
    const agreement = unwrap(await setFeeAgreement(f.deps, f.ctx, { membershipId: member.id, validFrom: '2026-01-01', paymentMethod: 'directDebit', iban: 'DE44999999990532013000', debtorName: 'Erika Gemischt' }));
    f.deps.db.update(financeSepaMandates).set({ signedOn: '2026-01-05' }).where(eq(financeSepaMandates.id, agreement.mandateId!)).run();
    enteredOn(f.deps, '2025-12-01');
    const january = f.deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, member.id)).all().find((c) => c.periodStart === '2026-01-01' && c.state === 'created')!;
    f.deps.db.update(memberFeeCharges).set({ paymentMethod: 'transfer' }).where(eq(memberFeeCharges.id, january.id)).run();
    // Heute 10.01., gefragt für den 01.03.: Januar (Überweisung) ist reif, Februar (Lastschrift) wird nicht gemahnt.
    const preview = unwrap(await previewDunningRun(f.deps, f.ctx, { asOf: '2026-03-01' }));
    expect(preview.ready.find((c) => c.membershipId === member.id)).toMatchObject({ chargeIds: [january.id] });
    expect(preview.skipped).toContainEqual(expect.objectContaining({ membershipId: member.id, reason: 'directDebit' }));
  });
});
