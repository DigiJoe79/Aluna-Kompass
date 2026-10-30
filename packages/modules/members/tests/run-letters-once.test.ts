import { unwrap, writeSettingInternal } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { documents } from '@kompass/module-dms';
import { FINANCE_PERMISSIONS } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { continueDunningRun, startDunningRun } from '../src/dunning';
import { continueFeeRun, startFeeRun } from '../src/fee-run';
import { admitMember } from '../src/memberships';
import { memberDunningNotices, memberDunningRuns, memberFeeRuns, memberRunLetters } from '../src/schema';
import { addressedPerson, enteredOn, MEMBERS_PERMISSIONS, setupFees } from './helpers';

// Plan R1 Task 3 (N7): Zwei Abschnitte desselben Laufs gleichzeitig (Neu laden, zweiter Tab) — je Mitgliedschaft ein Brief.
async function setup(now: string, validFrom: string) {
  const env = await setupFees({ now, validFrom, permissions: [...MEMBERS_PERMISSIONS, ...FINANCE_PERMISSIONS, 'dms.view'] });
  env.deps.db.transaction((tx) => {
    writeSettingInternal(tx, env.deps, systemContext(), 'organization.name', 'Musterverein e.V.');
    writeSettingInternal(tx, env.deps, systemContext(), 'organization.iban', 'DE23999999990000202051');
  });
  const admit = async (lastName: string, admittedOn: string) => unwrap(await admitMember(env.deps, env.ctx, { contactId: await addressedPerson(env.deps, { lastName }), typeId: env.types.regular, admittedOn, letter: false }));
  return { ...env, admit };
}

const lettersOf = (deps: Awaited<ReturnType<typeof setup>>['deps'], runRef: string) => deps.db.select().from(memberRunLetters).where(eq(memberRunLetters.runRef, runRef)).all();

describe('fee run: two parallel continues', () => {
  it('issue one notice per membership; the second leaves no document behind', async () => {
    const f = await setup('2026-11-15T08:00:00.000Z', '2027-01-01');
    const a = await f.admit('Erste', '2026-01-01');
    const b = await f.admit('Zweite', '2026-01-01');
    const run = unwrap(await startFeeRun(f.deps, f.ctx, { year: 2027, notices: 'all' }));
    const docsBefore = f.deps.db.select().from(documents).all().length;
    const [one, two] = await Promise.all([continueFeeRun(f.deps, f.ctx, { runId: run.id, max: 50 }), continueFeeRun(f.deps, f.ctx, { runId: run.id, max: 50 })]);
    expect(one.ok && two.ok).toBe(true);
    const letters = lettersOf(f.deps, `membersFeeRun:${run.id}`);
    expect(letters.map((l) => l.membershipId).sort()).toEqual([a.id, b.id].sort());
    expect(f.deps.db.select().from(documents).all().length - docsBefore).toBe(2);
    const row = f.deps.db.select().from(memberFeeRuns).where(eq(memberFeeRuns.id, run.id)).get()!;
    expect(row).toMatchObject({ status: 'done', noticeRefused: [] });
  });

  it('a refusal written by another continue meanwhile is kept (no lost update)', async () => {
    const f = await setup('2026-11-15T08:00:00.000Z', '2027-01-01');
    await f.admit('Erste', '2026-01-01');
    const run = unwrap(await startFeeRun(f.deps, f.ctx, { year: 2027, notices: 'all' }));
    const pending = continueFeeRun(f.deps, f.ctx, { runId: run.id, max: 50 });
    // Ein anderer Tab hält inzwischen eine Ablehnung fest.
    f.deps.db.update(memberFeeRuns).set({ noticeRefused: [{ membershipId: 'OTHER', code: 'contactAddressMissing' }] }).where(eq(memberFeeRuns.id, run.id)).run();
    unwrap(await pending);
    expect(f.deps.db.select().from(memberFeeRuns).where(eq(memberFeeRuns.id, run.id)).get()!.noticeRefused).toEqual([{ membershipId: 'OTHER', code: 'contactAddressMissing' }]);
  });
});

describe('dunning run: two parallel continues', () => {
  it('issue one reminder per membership, with one dunning note', async () => {
    const f = await setup('2026-01-20T08:00:00.000Z', '2026-01-01');
    const a = await f.admit('Mahnfall', '2026-01-01');
    enteredOn(f.deps, '2025-12-01');
    const run = unwrap(await startDunningRun(f.deps, f.ctx, { asOf: '2026-01-20' }));
    const [one, two] = await Promise.all([continueDunningRun(f.deps, f.ctx, { runId: run.id, max: 50 }), continueDunningRun(f.deps, f.ctx, { runId: run.id, max: 50 })]);
    expect(one.ok && two.ok).toBe(true);
    expect(lettersOf(f.deps, `membersDunningRun:${run.id}`).map((l) => l.membershipId)).toEqual([a.id]);
    expect(f.deps.db.select().from(memberDunningNotices).where(eq(memberDunningNotices.runId, run.id)).all()).toHaveLength(1);
    expect(f.deps.db.select().from(memberDunningRuns).where(eq(memberDunningRuns.id, run.id)).get()).toMatchObject({ status: 'done', refused: [] });
  });

  it('a refusal written by another continue meanwhile is kept (no lost update)', async () => {
    const f = await setup('2026-01-20T08:00:00.000Z', '2026-01-01');
    await f.admit('Mahnfall', '2026-01-01');
    enteredOn(f.deps, '2025-12-01');
    const run = unwrap(await startDunningRun(f.deps, f.ctx, { asOf: '2026-01-20' }));
    const pending = continueDunningRun(f.deps, f.ctx, { runId: run.id, max: 50 });
    f.deps.db.update(memberDunningRuns).set({ refused: [{ membershipId: 'OTHER', code: 'contactAddressMissing' }] }).where(eq(memberDunningRuns.id, run.id)).run();
    unwrap(await pending);
    expect(f.deps.db.select().from(memberDunningRuns).where(eq(memberDunningRuns.id, run.id)).get()!.refused).toEqual([{ membershipId: 'OTHER', code: 'contactAddressMissing' }]);
  });
});
