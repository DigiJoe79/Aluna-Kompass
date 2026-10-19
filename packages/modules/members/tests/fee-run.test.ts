import { unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { cancelOpenItem, categoryIdByKeyInternal, financeOpenItems, setCategoryActive } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { continueFeeRun, getFeeRun, listFeeRuns, previewFeeRun, startFeeRun } from '../src/fee-run';
import { admitMember, recordApplication } from '../src/memberships';
import { memberFeeCharges } from '../src/schema';
import { saveMemberType } from '../src/types';
import { asMcp, auditOf, person, setupFees, type MembersDeps } from './helpers';

const NOW = '2027-09-05T08:00:00.000Z';
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);

async function admit(deps: MembersDeps, ctx: CallContext, typeId: string, joinedOn = '2026-01-01', extra: Record<string, unknown> = {}) {
  return unwrap(await admitMember(deps, ctx, { contactId: await person(deps), typeId, admittedOn: joinedOn, joinedOn, ...extra }));
}

/** Fünf Mitgliedschaften: zwei ordentliche (jährlich), ein Fördermitglied (monatlich), ein Ehrenmitglied, ein offener Antrag. */
async function fiveMembers() {
  const env = await setupFees({ now: NOW });
  const { deps, ctx, types } = env;
  const members = [await admit(deps, ctx, types.regular), await admit(deps, ctx, types.regular), await admit(deps, ctx, types.supporting), await admit(deps, ctx, types.honorary)];
  unwrap(await recordApplication(deps, ctx, { contactId: await person(deps), typeId: types.regular, appliedOn: '2027-08-01' }));
  return { ...env, members };
}

async function runAll(deps: MembersDeps, ctx: CallContext, year = 2027) {
  const run = unwrap(await startFeeRun(deps, ctx, { year }));
  let view = run;
  while (view.status === 'running') view = unwrap(await continueFeeRun(deps, ctx, { runId: run.id, max: 50 }));
  return view;
}

const items = (deps: MembersDeps) => deps.db.select().from(financeOpenItems).all();

describe('fee run', () => {
  it('previews per member: 1 + 1 + 12 to create, honorary exempt, the application not at all', async () => {
    const { deps, ctx, members } = await fiveMembers();
    const preview = unwrap(await previewFeeRun(deps, ctx, { year: 2027 }));
    const outcome = (i: number) => preview.items.filter((p) => p.membershipId === members[i]!.id).map((p) => p.outcome);
    expect(outcome(0)).toEqual(['create']);
    expect(outcome(1)).toEqual(['create']);
    expect(outcome(2)).toEqual(Array(12).fill('create'));
    expect(outcome(3)).toEqual(['exempt']);
    expect(preview.items).toHaveLength(15);
    expect(preview.totals).toEqual({ count: 14, sumCents: 1200 + 1200 + 12 * 1000 });
    expect(preview.items[0]).toMatchObject({ memberNumber: '0001', name: expect.any(String), periodStart: '2027-01-01', amountCents: 1200 });
  });

  it('creates open items with origin, reference and line template; finance cannot cancel them', async () => {
    const { deps, ctx, members } = await fiveMembers();
    const done = await runAll(deps, ctx);
    expect(done).toMatchObject({ status: 'done', created: 14, pending: 0 });
    const all = items(deps);
    expect(all).toHaveLength(14);
    expect(all.map((i) => i.paymentReference)).toEqual(expect.arrayContaining(['Beitrag 2027 Mitglied 0001', 'Beitrag 2027 Mitglied 0002', 'Beitrag 2027-03 Mitglied 0003']));
    const first = all.find((i) => i.paymentReference === 'Beitrag 2027 Mitglied 0001')!;
    const charge = deps.db.select().from(memberFeeCharges).all().find((c) => c.openItemId === first.id)!;
    expect(first).toMatchObject({ kind: 'receivable', originType: 'memberFeeCharge', originId: charge.id, contactId: members[0]!.contactId, amountCents: 1200, dueOn: '2027-01-01', itemDate: '2027-09-05' });
    expect(JSON.parse(first.lineTemplate!)).toEqual([{ categoryId: categoryIdByKeyInternal(deps.db, 'membership-fees'), amountCents: 1200, contactId: members[0]!.contactId }]);
    expect(charge).toMatchObject({ state: 'created', periodStart: '2027-01-01', runId: done.id });
    expect(fail(await cancelOpenItem(deps, ctxWith(['finance.entriesFinalize']), { id: first.id, note: 'Irrtum' }))).toMatchObject({ code: 'openItemHasOrigin' });
    expect(auditOf(deps, 'members.feeRun.start').map((e) => e.params)).toEqual([{ year: 2027, count: 14 }]);
    expect(auditOf(deps, 'members.feeRun.finish').map((e) => e.params)).toEqual([{ year: 2027, count: 14 }]);
  });

  it('lists the runs newest first and reads one (members.read)', async () => {
    const { deps, ctx } = await fiveMembers();
    const run = unwrap(await startFeeRun(deps, ctx, { year: 2027 }));
    expect(unwrap(await listFeeRuns(deps, ctx, {}))).toMatchObject({ total: 1, items: [{ id: run.id, year: 2027, status: 'running', pending: 14 }] });
    expect(unwrap(await getFeeRun(deps, ctx, run.id))).toMatchObject({ id: run.id, created: 0 });
    expect(fail(await getFeeRun(deps, ctx, 'nope'))).toMatchObject({ type: 'notFound' });
    expect(fail(await listFeeRuns(deps, ctxWith(['members.fees']), {}))).toMatchObject({ type: 'forbidden' });
  });

  it('works in chunks of at most max', async () => {
    const { deps, ctx } = await fiveMembers();
    const run = unwrap(await startFeeRun(deps, ctx, { year: 2027 }));
    expect(run).toMatchObject({ status: 'running', pending: 14, created: 0 });
    expect(unwrap(await continueFeeRun(deps, ctx, { runId: run.id, max: 5 }))).toMatchObject({ status: 'running', pending: 9, created: 5 });
    expect(fail(await continueFeeRun(deps, ctx, { runId: run.id, max: 51 }))).toMatchObject({ type: 'validation' });
  });

  it('a second run for the same year creates nothing; a running one blocks a second start', async () => {
    const { deps, ctx } = await fiveMembers();
    const running = unwrap(await startFeeRun(deps, ctx, { year: 2027 }));
    expect(fail(await startFeeRun(deps, ctx, { year: 2027 }))).toMatchObject({ type: 'conflict', code: 'feeRunRunning' });
    expect(unwrap(await continueFeeRun(deps, ctx, { runId: running.id, max: 50 })).status).toBe('done');
    expect(unwrap(await previewFeeRun(deps, ctx, { year: 2027 })).items.filter((i) => i.outcome === 'exists')).toHaveLength(14);
    expect(fail(await startFeeRun(deps, ctx, { year: 2027 }))).toMatchObject({ type: 'conflict', code: 'feeRunNothingToCreate' });
    expect(items(deps)).toHaveLength(14);
  });

  it('an admission on 15 August creates the fee of the year at once; a later run does not double it', async () => {
    const { deps, ctx, types } = await fiveMembers();
    const late = await admit(deps, ctx, types.regular, '2027-08-15');
    expect(items(deps).map((i) => [i.paymentReference, i.dueOn])).toEqual([[`Beitrag 2027 Mitglied ${late.memberNumber}`, '2027-08-15']]);
    expect(deps.db.select().from(memberFeeCharges).all()[0]).toMatchObject({ runId: null, state: 'created' });
    await runAll(deps, ctx);
    expect(items(deps).filter((i) => i.paymentReference === `Beitrag 2027 Mitglied ${late.memberNumber}`)).toHaveLength(1);
    expect(items(deps)).toHaveLength(15);
  });

  it('an admission with createFees false, or for a future year without run, creates nothing', async () => {
    const { deps, ctx, types } = await setupFees({ now: NOW });
    await admit(deps, ctx, types.regular, '2027-08-15', { createFees: false });
    await admit(deps, ctx, types.regular, '2028-01-01');
    expect(items(deps)).toHaveLength(0);
  });

  it('a type without rule is skipped with noRule instead of 0 €', async () => {
    const { deps, ctx } = await setupFees({ now: NOW });
    const youth = unwrap(await saveMemberType(deps, ctx, { key: 'youth', name: { de: 'Jugend' }, hasVotingRight: false, feeExempt: false }));
    await admit(deps, ctx, youth.id);
    expect(unwrap(await previewFeeRun(deps, ctx, { year: 2027 })).items.map((i) => i.outcome)).toEqual(['noRule']);
    expect(fail(await startFeeRun(deps, ctx, { year: 2027 }))).toMatchObject({ code: 'feeRunNothingToCreate' });
  });

  it('refuses with membershipFeeCategoryMissing when the category is deactivated — at start and while running', async () => {
    const { deps, ctx } = await fiveMembers();
    const run = unwrap(await startFeeRun(deps, ctx, { year: 2027 }));
    const categoryId = categoryIdByKeyInternal(deps.db, 'membership-fees')!;
    unwrap(await setCategoryActive(deps, ctxWith(['finance.setup']), { id: categoryId, isActive: false }));
    expect(fail(await continueFeeRun(deps, ctx, { runId: run.id, max: 50 }))).toMatchObject({ type: 'conflict', code: 'membershipFeeCategoryMissing' });
    expect(items(deps)).toHaveLength(0);
    expect(deps.db.select().from(memberFeeCharges).all().every((c) => c.state === 'pending')).toBe(true);
  });

  it('start refuses without the category too', async () => {
    const { deps, ctx } = await fiveMembers();
    unwrap(await setCategoryActive(deps, ctxWith(['finance.setup']), { id: categoryIdByKeyInternal(deps.db, 'membership-fees')!, isActive: false }));
    expect(fail(await startFeeRun(deps, ctx, { year: 2027 }))).toMatchObject({ code: 'membershipFeeCategoryMissing' });
  });

  it('start and continue are human only; preview needs members.read, start members.fees', async () => {
    const { deps, ctx } = await fiveMembers();
    expect(fail(await startFeeRun(deps, asMcp(ctx), { year: 2027 }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    const run = unwrap(await startFeeRun(deps, ctx, { year: 2027 }));
    expect(fail(await continueFeeRun(deps, asMcp(ctx), { runId: run.id, max: 5 }))).toMatchObject({ code: 'humanOnly' });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'members.mcpHumanOnlyAllowed', true));
    expect((await continueFeeRun(deps, asMcp(ctx), { runId: run.id, max: 5 })).ok).toBe(true);
    expect(fail(await previewFeeRun(deps, ctxWith([]), { year: 2027 }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await startFeeRun(deps, ctxWith(['members.read']), { year: 2027 }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await previewFeeRun(deps, ctx, { year: 'next' }))).toMatchObject({ type: 'validation' });
  });
});
