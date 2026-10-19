import { seedStoryYear } from '@kompass/core';
import { ctxWith, fakeMailTransport } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { filterMemberships } from '../src/memberships';
import { listFees } from '../src/fees';
import { memberDunningNotices, memberFeeAgreements, memberFeeCharges, memberFeeRuns, memberFeeSchedules, memberMemberships, memberRunLetters, memberTypePeriods } from '../src/schema';
import { documents } from '@kompass/module-dms';
import { financeSepaMandates, seedFinance } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { runDispatchState } from '../src/run-dispatch';
import { seedMembers } from '../src/seed';
import { setupMembers } from './helpers';

const ALL = ['members.read', 'members.manage', 'members.fees', 'contacts.view', 'contacts.manage'];
const DATE_FIELDS = ['appliedOn', 'admittedOn', 'rejectedOn', 'joinedOn', 'endsOn', 'endNoticeOn'] as const;

async function seeded(now: string) {
  const { deps, userId } = setupMembers(ALL, { now });
  const ctx = ctxWith(ALL, userId);
  await seedMembers(deps, ctx);
  return { deps, ctx };
}

describe('seedMembers', () => {
  it('seeds about ten memberships in every state and is idempotent', async () => {
    const { deps, ctx } = await seeded('2026-09-05T08:00:00.000Z');
    const count = deps.db.select().from(memberMemberships).all().length;
    expect(count).toBe(11);
    await seedMembers(deps, ctx);
    expect(deps.db.select().from(memberMemberships).all().length).toBe(count);

    const views = filterMemberships(deps, {});
    const statuses = new Set(views.map((v) => v.status));
    for (const s of ['applied', 'rejected', 'active', 'ending', 'ended']) expect(statuses, s).toContain(s);
    expect(views.filter((v) => v.status === 'active').map((v) => v.typeKey).sort()).toEqual(['honorary', 'regular', 'regular', 'regular', 'supporting', 'supporting', 'supporting']);
    expect(views.some((v) => v.contactName === 'Bäckerei Morgenrot GmbH' && v.typeKey === 'supporting')).toBe(true);
    expect(views.find((v) => v.endReason === 'resignation')?.endsOn).toBe('2026-12-31');
    expect(views.find((v) => v.endReason === 'death')?.endsOn).toBe('2026-01-09');
    expect(views.some((v) => v.status === 'active' && v.appliedOn === null)).toBe(true); // Gründungsmitglied
  });

  it.each(['2026-09-05T08:00:00.000Z', '2027-03-01T08:00:00.000Z', '2027-12-30T08:00:00.000Z'])('keeps every day in the story year and the year before (%s)', async (now) => {
    const { deps } = await seeded(now);
    const y = seedStoryYear(now.slice(0, 10));
    const years = new Set([String(y - 1), String(y)]);
    const days = [
      ...deps.db.select().from(memberMemberships).all().flatMap((r) => DATE_FIELDS.map((f) => r[f]).filter((d): d is string => d !== null)),
      ...deps.db.select().from(memberTypePeriods).all().map((p) => p.validFrom),
    ];
    expect(days.length).toBeGreaterThan(20);
    expect(days.filter((d) => !years.has(d.slice(0, 4)))).toEqual([]);
  });
});

describe('seedMembers: fees (Plan M3)', () => {
  async function seededWithFinance(now: string) {
    // Mit Mailversand: sonst gibt es im Versand der Läufe keine Mail-Gruppe (Plan U4 Task 2).
    const { deps, userId } = setupMembers(ALL, { now, mail: fakeMailTransport() });
    const ctx = ctxWith([...deps.registry.permissionKeys], userId);
    await seedFinance(deps, ctx);
    await seedMembers(deps, ctx);
    return { deps, ctx };
  }

  it.each(['2026-09-05T08:00:00.000Z', '2027-03-01T08:00:00.000Z'])('seeds schedule, agreements and the fee run of the story year with every state, idempotent (%s)', async (now) => {
    const { deps, ctx } = await seededWithFinance(now);
    const y = seedStoryYear(now.slice(0, 10));
    expect(deps.db.select().from(memberFeeSchedules).all().map((s) => s.validFrom).sort()).toEqual([`${y - 1}-01-01`, `${y}-01-01`]);
    const agreements = deps.db.select().from(memberFeeAgreements).all();
    expect(agreements.some((a) => a.reduction === 'reduced')).toBe(true);
    expect(agreements.some((a) => a.reduction === 'none' && a.amountCents !== null)).toBe(true);
    // Plan L1: zwei Mitglieder per Lastschrift, je mit einem Mandat der Finanzen.
    const direct = agreements.filter((a) => a.paymentMethod === 'directDebit');
    expect(direct).toHaveLength(2);
    expect(direct.every((a) => a.mandateId !== null && deps.db.select().from(financeSepaMandates).where(eq(financeSepaMandates.id, a.mandateId!)).get() !== undefined)).toBe(true);
    expect(deps.db.select().from(memberFeeRuns).all().map((r) => [r.year, r.status])).toEqual([[y, 'done']]);

    const fees = await listFees(deps, ctx, { year: y, limit: 200 });
    const items = fees.ok ? fees.value.items : [];
    const states = new Set(items.map((f) => f.state));
    for (const s of ['open', 'partlyPaid', 'paid', 'waived']) expect(states, s).toContain(s);
    expect(items.some((f) => f.overdue)).toBe(true);
    expect(items.some((f) => f.deferredTo !== null)).toBe(true);

    const count = deps.db.select().from(memberFeeCharges).all().length;
    await seedMembers(deps, ctx);
    expect(deps.db.select().from(memberFeeCharges).all().length).toBe(count);

    // Plan U4 Task 2: Im Versand des Beitragslaufs liegt eine Mitteilung von Hand in der Post-Gruppe.
    const run = deps.db.select().from(memberFeeRuns).get()!;
    const dispatch = await runDispatchState(deps, ctx, { runRef: `membersFeeRun:${run.id}` });
    expect(dispatch.ok && dispatch.value.post.some((p) => p.reason === 'manual')).toBe(true);
  });

  it.each(['2026-09-05T08:00:00.000Z', '2027-03-01T08:00:00.000Z'])('seeds the letters: admissions, a fee notice, a reminder dispatched and a dunning letter not yet (Plan M4, %s)', async (now) => {
    const { deps, ctx } = await seededWithFinance(now);
    const types = (key: string) => deps.db.select().from(documents).all().filter((d) => d.typeKey === key);
    expect(types('member-admission').length).toBeGreaterThanOrEqual(3);
    expect(types('member-fee-notice').length).toBeGreaterThanOrEqual(1);
    const notices = deps.db.select().from(memberDunningNotices).all();
    const sentAt = (documentId: string) => deps.db.select().from(documents).where(eq(documents.id, documentId)).get()!.sentAt;
    expect(notices.some((n) => n.levelKey === 'reminder' && sentAt(n.documentId) !== null)).toBe(true);
    expect(notices.some((n) => n.levelKey === 'dunning' && sentAt(n.documentId) === null)).toBe(true);
    expect(deps.db.select().from(memberRunLetters).all().length).toBeGreaterThan(notices.length - 1);
    const count = deps.db.select().from(documents).all().length;
    await seedMembers(deps, ctx);
    expect(deps.db.select().from(documents).all().length).toBe(count);
  });
});
