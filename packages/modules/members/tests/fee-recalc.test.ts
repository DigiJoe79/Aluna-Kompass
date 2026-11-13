import { unwrap, type CallContext } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createAccount, FINANCE_PERMISSIONS, financeDirectDebitItems, financeDirectDebitRuns, financeOpenItems, prepareMandate } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setFeeAgreement } from '../src/fee-agreement';
import { previewRecalculation } from '../src/fee-recalc';
import { continueFeeRun, startFeeRun } from '../src/fee-run';
import { saveFeeSchedule } from '../src/fee-schedule';
import { saveMembersSettings } from '../src/settings-service';
import { admitMember, changeMemberType, endMembership, recordResignation, revokeEnd } from '../src/memberships';
import { memberFeeCharges } from '../src/schema';
import { MEMBERS_MCP_TOOLS } from '../src/mcp-tools';
import { auditOf, payOpenItem, person, setupFees, type MembersDeps } from './helpers';

const NOW = '2027-02-10T08:00:00.000Z';
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);

async function runYear(deps: MembersDeps, ctx: CallContext) {
  const run = unwrap(await startFeeRun(deps, ctx, { year: 2027 }));
  unwrap(await continueFeeRun(deps, ctx, { runId: run.id, max: 50 }));
}

async function member(deps: MembersDeps, ctx: CallContext, typeId: string) {
  return unwrap(await admitMember(deps, ctx, { contactId: await person(deps), typeId, admittedOn: '2026-01-01', joinedOn: '2026-01-01' }));
}

/** Die Beiträge einer Mitgliedschaft mit ihrem Posten: Zeitraumbeginn, Betrag, Zustand, Posten storniert. */
function charges(deps: MembersDeps, membershipId: string) {
  return deps.db
    .select()
    .from(memberFeeCharges)
    .where(eq(memberFeeCharges.membershipId, membershipId))
    .all()
    .map((c) => {
      const item = c.openItemId ? deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.id, c.openItemId)).get() : undefined;
      return { start: c.periodStart, amount: c.amountCents, state: c.state, cancelled: item?.cancelledAt != null, openItemId: c.openItemId };
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.state.localeCompare(b.state));
}
const live = (deps: MembersDeps, id: string) => charges(deps, id).filter((c) => c.state !== 'replaced');

async function supportingMonthly() {
  const env = await setupFees({ now: NOW });
  const m = await member(env.deps, env.ctx, env.types.supporting);
  await runYear(env.deps, env.ctx);
  return { ...env, m };
}

describe('recalculation on type change', () => {
  async function halfYearly() {
    const env = await setupFees({ now: NOW });
    const { deps, ctx, types, schedule } = env;
    unwrap(
      await saveFeeSchedule(deps, ctx, {
        id: schedule.id,
        validFrom: '2027-01-01',
        rules: [
          { typeId: types.regular, amountCents: 600, interval: 'halfYearly', allowedIntervals: ['halfYearly'] },
          { typeId: types.supporting, amountCents: 3000, interval: 'halfYearly', minimum: true, allowedIntervals: ['halfYearly'] },
        ],
      }),
    );
    const m = await member(deps, ctx, types.regular);
    await runYear(deps, ctx);
    return { ...env, m };
  }

  it('a change on 1 July replaces the unpaid second half; the first half stays', async () => {
    const { deps, ctx, types, m } = await halfYearly();
    unwrap(await changeMemberType(deps, ctx, { membershipId: m.id, typeId: types.supporting, validFrom: '2027-07-01' }));
    expect(live(deps, m.id).map((c) => [c.start, c.amount, c.cancelled])).toEqual([
      ['2027-01-01', 600, false],
      ['2027-07-01', 3000, false],
    ]);
    expect(charges(deps, m.id).filter((c) => c.state === 'replaced').map((c) => [c.start, c.amount, c.cancelled])).toEqual([['2027-07-01', 600, true]]);
    expect(auditOf(deps, 'members.fees.recalculate').map((e) => e.params)).toEqual([{ memberNumber: m.memberNumber, replaced: 1, added: 1 }]);
  });

  it('a paid second half stays with its old amount', async () => {
    const { deps, ctx, types, m } = await halfYearly();
    await payOpenItem(deps, live(deps, m.id)[1]!.openItemId!, 600, '2027-02-05');
    unwrap(await changeMemberType(deps, ctx, { membershipId: m.id, typeId: types.supporting, validFrom: '2027-07-01' }));
    expect(live(deps, m.id).map((c) => [c.start, c.amount])).toEqual([
      ['2027-01-01', 600],
      ['2027-07-01', 600],
    ]);
    expect(auditOf(deps, 'members.fees.recalculate')).toEqual([]);
  });

  it('a second half in a direct debit submitted to the bank or with a file stays; in a draft it is replaced (Plan L2, R1)', async () => {
    for (const status of ['submitted', 'fileCreated', 'draft'] as const) {
      const { deps, ctx, types, m } = await halfYearly();
      const openItemId = live(deps, m.id)[1]!.openItemId!;
      const fin: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, ...FINANCE_PERMISSIONS]) };
      const account = unwrap(await createAccount(deps, fin, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
      const mandate = unwrap(await prepareMandate(deps, fin, { contactId: m.contactId, debtorName: 'Erika Beispiel', iban: 'DE44999999990532013000' }));
      const at = '2027-02-01T10:00:00.000Z';
      deps.db.insert(financeDirectDebitRuns).values({ id: `R-${status}`, collectionDate: '2027-07-01', accountId: account.id, status, messageId: `R-${status}`, createdByUserId: 'U1', createdAt: at, updatedAt: at }).run();
      deps.db.insert(financeDirectDebitItems).values({ id: `I-${status}`, runId: `R-${status}`, mandateId: mandate.id, source: 'openItem', sourceId: openItemId, amountCents: 600, endToEndId: `R-${status}-1`, remittance: 'Beitrag', createdAt: at }).run();
      unwrap(await changeMemberType(deps, ctx, { membershipId: m.id, typeId: types.supporting, validFrom: '2027-07-01' }));
      expect(live(deps, m.id).map((c) => [c.start, c.amount]), status).toEqual([
        ['2027-01-01', 600],
        ['2027-07-01', status === 'draft' ? 3000 : 600],
      ]);
    }
  });
});

describe('recalculation on a change of rhythm (Plan R1, M2)', () => {
  const after = (deps: MembersDeps, id: string) => live(deps, id).filter((c) => c.start >= '2027-07-01').map((c) => [c.start, c.amount]);
  const toRegular = (env: Awaited<ReturnType<typeof supportingMonthly>>) => ({ membershipId: env.m.id, typeId: env.types.regular, validFrom: '2027-07-01' });

  it('monthly to yearly from 1 July with July paid: a new fee 1 August to 31 December with 5/12 of the yearly amount', async () => {
    const env = await supportingMonthly();
    const july = live(env.deps, env.m.id).find((c) => c.start === '2027-07-01')!;
    await payOpenItem(env.deps, july.openItemId!, 1000, '2027-02-05');
    const preview = unwrap(await MEMBERS_MCP_TOOLS.find((t) => t.name === 'members_fee_recalc_preview')!.handler(env.deps, env.ctx, { membershipId: env.m.id, from: '2027-07-01', change: { kind: 'type', typeId: env.types.regular } })) as { add: { periodStart: string; periodEnd: string; amountCents: number }[] };
    expect(preview.add.map((c) => [c.periodStart, c.periodEnd, c.amountCents])).toEqual([['2027-08-01', '2027-12-31', 500]]);
    unwrap(await changeMemberType(env.deps, env.ctx, toRegular(env)));
    expect(after(env.deps, env.m.id)).toEqual([
      ['2027-07-01', 1000],
      ['2027-08-01', 500],
    ]);
    expect(live(env.deps, env.m.id).find((c) => c.start === '2027-08-01')).toMatchObject({ cancelled: false });
  });

  it('with July unpaid, July is replaced and the new period runs from 1 July', async () => {
    const env = await supportingMonthly();
    unwrap(await changeMemberType(env.deps, env.ctx, toRegular(env)));
    expect(after(env.deps, env.m.id)).toEqual([['2027-07-01', 600]]);
  });
});

/**
 * B7b (0.5.2, Joe 2026-11-12): Ein Typwechsel am Eintrittstag wirkt wie ein Eintritt mit der neuen Art — der
 * Eintrittszeitraum folgt der eingestellten Eintrittsjahr-Regel. Maßstab ist ein Mitglied, das am selben Tag gleich mit
 * der neuen Art eintritt; die Regel steht nicht im Test.
 */
describe('a type change on the join day (B7b)', () => {
  const shape = (deps: MembersDeps, id: string) =>
    deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, id)).all().filter((c) => c.state !== 'replaced').map((c) => [c.periodStart, c.periodEnd, c.amountCents, c.dueOn]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const admit = async (env: Awaited<ReturnType<typeof setupFees>>, typeId: string, joinedOn: string) =>
    unwrap(await admitMember(env.deps, env.ctx, { contactId: await person(env.deps), typeId, admittedOn: '2027-02-01', joinedOn }));

  for (const rule of ['full', 'proRataMonths'] as const) {
    for (const joinedOn of ['2027-07-01', '2027-07-15']) {
      for (const [from, to] of [['supporting', 'regular'], ['regular', 'supporting']] as const) {
        it(`${from} → ${to} on the join day ${joinedOn} (${rule}) charges as if joined with ${to}`, async () => {
          const env = await setupFees({ now: NOW });
          unwrap(await saveMembersSettings(env.deps, env.ctx, { joinYearRule: rule }));
          const changed = await admit(env, env.types[from], joinedOn);
          unwrap(await changeMemberType(env.deps, env.ctx, { membershipId: changed.id, typeId: env.types[to], validFrom: joinedOn }));
          const direct = await admit(env, env.types[to], joinedOn);
          expect(shape(env.deps, changed.id)).toEqual(shape(env.deps, direct.id));
        });
      }
    }
  }

  it('with the first month paid no new fee reaches back before the join month', async () => {
    const env = await setupFees({ now: NOW });
    const m = await admit(env, env.types.supporting, '2027-07-01');
    const july = live(env.deps, m.id).find((c) => c.start === '2027-07-01')!;
    await payOpenItem(env.deps, july.openItemId!, 1000, '2027-02-05');
    unwrap(await changeMemberType(env.deps, env.ctx, { membershipId: m.id, typeId: env.types.regular, validFrom: '2027-07-01' }));
    expect(live(env.deps, m.id).map((c) => [c.start, c.amount])).toEqual([
      ['2027-07-01', 1000],
      ['2027-08-01', 500],
    ]);
  });

  it('a change later than the join day stays as before: from then on, pro rata', async () => {
    const env = await setupFees({ now: NOW });
    const m = await admit(env, env.types.supporting, '2027-07-01');
    unwrap(await changeMemberType(env.deps, env.ctx, { membershipId: m.id, typeId: env.types.regular, validFrom: '2027-09-01' }));
    expect(shape(env.deps, m.id)).toEqual([
      ['2027-07-01', '2027-07-31', 1000, '2027-07-01'],
      ['2027-08-01', '2027-08-31', 1000, '2027-08-01'],
      ['2027-09-01', '2027-12-31', 400, '2027-09-01'],
    ]);
  });
});

describe('recalculation with a fee in a run with a file (Plan R1)', () => {
  async function halfYearlyFor() {
    const env = await setupFees({ now: NOW });
    unwrap(await saveFeeSchedule(env.deps, env.ctx, { id: env.schedule.id, validFrom: '2027-01-01', rules: [{ typeId: env.types.regular, amountCents: 600, interval: 'halfYearly', allowedIntervals: ['halfYearly'] }] }));
    const m = await member(env.deps, env.ctx, env.types.regular);
    await runYear(env.deps, env.ctx);
    return { ...env, m };
  }

  it('a second half in a run with a file that no longer falls due (end) refuses the change (Plan R1, Review I1)', async () => {
    const { deps, ctx, m } = await halfYearlyFor();
    const openItemId = live(deps, m.id)[1]!.openItemId!;
    const fin: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, ...FINANCE_PERMISSIONS]) };
    const account = unwrap(await createAccount(deps, fin, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
    const mandate = unwrap(await prepareMandate(deps, fin, { contactId: m.contactId, debtorName: 'Erika Beispiel', iban: 'DE44999999990532013000' }));
    const at = '2027-02-01T10:00:00.000Z';
    deps.db.insert(financeDirectDebitRuns).values({ id: 'R-F', collectionDate: '2027-07-01', accountId: account.id, status: 'fileCreated', messageId: 'R-F', createdByUserId: 'U1', createdAt: at, updatedAt: at }).run();
    deps.db.insert(financeDirectDebitItems).values({ id: 'I-F', runId: 'R-F', mandateId: mandate.id, source: 'openItem', sourceId: openItemId, amountCents: 600, endToEndId: 'R-F-1', remittance: 'Beitrag', createdAt: at }).run();
    expect(fail(await endMembership(deps, ctx, { membershipId: m.id, endsOn: '2027-06-30', reason: 'other' }))).toMatchObject({ type: 'conflict', code: 'openItemInDirectDebit', params: { runId: 'R-F' } });
    expect(live(deps, m.id).map((c) => [c.start, c.cancelled])).toEqual([['2027-01-01', false], ['2027-07-01', false]]);
  });
});

describe('recalculation on end and revoked end', () => {
  it('resignation on 31 March, monthly: April to December cancelled, January to March stay', async () => {
    const { deps, ctx, m } = await supportingMonthly();
    unwrap(await recordResignation(deps, ctx, { membershipId: m.id, noticeOn: '2027-02-01', endsOn: '2027-03-31' }));
    expect(live(deps, m.id).map((c) => c.start)).toEqual(['2027-01-01', '2027-02-01', '2027-03-01']);
    expect(charges(deps, m.id).filter((c) => c.state === 'replaced' && c.cancelled)).toHaveLength(9);
    expect(auditOf(deps, 'members.fees.recalculate').map((e) => e.params)).toEqual([{ memberNumber: m.memberNumber, replaced: 9, added: 0 }]);
  });

  it('revoking the end creates April to December again as new lines', async () => {
    const { deps, ctx, m } = await supportingMonthly();
    unwrap(await recordResignation(deps, ctx, { membershipId: m.id, noticeOn: '2027-02-01', endsOn: '2027-03-31' }));
    unwrap(await revokeEnd(deps, ctx, { membershipId: m.id }));
    expect(live(deps, m.id).map((c) => [c.start, c.amount, c.cancelled])).toEqual(Array.from({ length: 12 }, (_, i) => [`2027-${String(i + 1).padStart(2, '0')}-01`, 1000, false]));
    expect(charges(deps, m.id)).toHaveLength(21);
  });

  it('an end for another reason recalculates as well', async () => {
    const { deps, ctx, m } = await supportingMonthly();
    unwrap(await endMembership(deps, ctx, { membershipId: m.id, endsOn: '2027-06-30', reason: 'death' }));
    expect(live(deps, m.id)).toHaveLength(6);
  });
});

describe('recalculation on a new agreement', () => {
  it('10 € to 15 € from 1 July: July to December replaced, a paid August stays with 10 €', async () => {
    const { deps, ctx, m } = await supportingMonthly();
    await payOpenItem(deps, live(deps, m.id)[7]!.openItemId!, 1000, '2027-02-05');
    unwrap(await setFeeAgreement(deps, ctx, { membershipId: m.id, validFrom: '2027-07-01', amountCents: 1500, paymentMethod: 'transfer', reduction: 'none' }));
    expect(live(deps, m.id).slice(6).map((c) => [c.start, c.amount])).toEqual([
      ['2027-07-01', 1500],
      ['2027-08-01', 1000],
      ['2027-09-01', 1500],
      ['2027-10-01', 1500],
      ['2027-11-01', 1500],
      ['2027-12-01', 1500],
    ]);
    expect(live(deps, m.id).slice(0, 6).every((c) => c.amount === 1000)).toBe(true);
  });
});

describe('previewRecalculation', () => {
  it('predicts the same without writing', async () => {
    const { deps, ctx, m } = await supportingMonthly();
    await payOpenItem(deps, live(deps, m.id)[7]!.openItemId!, 1000, '2027-02-05');
    const before = charges(deps, m.id);
    const preview = unwrap(await previewRecalculation(deps, ctx, { membershipId: m.id, from: '2027-07-01', change: { kind: 'agreement', amountCents: 1500, paymentMethod: 'transfer', reduction: 'none' } }));
    expect(preview.replace.map((c) => c.periodStart)).toEqual(['2027-07-01', '2027-09-01', '2027-10-01', '2027-11-01', '2027-12-01']);
    expect(preview.keep.map((c) => c.periodStart)).toEqual(['2027-08-01']);
    expect(preview.add.map((c) => [c.periodStart, c.amountCents])).toEqual(['2027-07-01', '2027-09-01', '2027-10-01', '2027-11-01', '2027-12-01'].map((d) => [d, 1500]));
    expect(charges(deps, m.id)).toEqual(before);

    const end = unwrap(await previewRecalculation(deps, ctx, { membershipId: m.id, from: '2027-03-31', change: { kind: 'end', endsOn: '2027-03-31' } }));
    expect([end.replace.length, end.keep.map((c) => c.periodStart), end.add.length]).toEqual([8, ['2027-08-01'], 0]);
    expect(unwrap(await previewRecalculation(deps, ctx, { membershipId: m.id, from: '2027-01-01' }))).toEqual({ replace: [], keep: [], add: [], transferKept: [], debitAnnounced: [] });
  });

  it('needs members.read and a valid input', async () => {
    const { deps, m } = await supportingMonthly();
    expect(fail(await previewRecalculation(deps, ctxWith([]), { membershipId: m.id, from: '2027-01-01' }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await previewRecalculation(deps, ctxWith(['members.read']), { membershipId: m.id, from: 'bald' }))).toMatchObject({ type: 'validation' });
  });
});
