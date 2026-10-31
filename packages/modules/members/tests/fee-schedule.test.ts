import { defineModule, isModuleEnabled, newId, unwrap, type CallContext } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { registerResolutionFactsSource, type ResolutionFacts } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deleteFeeSchedule, feeRuleAt, listFeeSchedules, saveFeeSchedule } from '../src/fee-schedule';
import { memberFeeCharges, memberFeeRules, memberMemberships, memberTypes } from '../src/schema';
import { auditOf, setupMembers, type MembersDeps } from './helpers';

// TEST_NOW: 2026-09-05
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);
const typeId = (deps: MembersDeps, key: string) => deps.db.select().from(memberTypes).where(eq(memberTypes.key, key)).get()!.id;

function rules(deps: MembersDeps, regularCents: number) {
  return [
    { typeId: typeId(deps, 'regular'), amountCents: regularCents, interval: 'yearly' as const, minimum: false, allowedIntervals: ['yearly' as const] },
    { typeId: typeId(deps, 'supporting'), amountCents: 1000, interval: 'monthly' as const, minimum: true, allowedIntervals: ['monthly' as const, 'yearly' as const] },
  ];
}

/** Ein Dokument der Akte, wie es die Prüfung des Beschlusses sieht. */
function resolutionDocument(deps: MembersDeps, o: { phase?: 'draft' | 'issued'; status?: 'issued' | 'voided' } = {}) {
  const id = newId();
  deps.db.insert(documents).values({ id, phase: o.phase ?? 'issued', status: o.status ?? 'issued', direction: 'incoming', sourceKind: 'uploaded', typeKey: 'member-application', number: `MAN-2026-${id.slice(-4)}`, documentDate: '2025-12-01', createdByUserId: 'U1', createdAt: '2025-12-01T00:00:00.000Z', updatedAt: '2025-12-01T00:00:00.000Z' }).run();
  return id;
}

const reading = (ctx: CallContext): CallContext => ({ ...ctx, permissions: new Set([...ctx.permissions, 'dms.view']) });

async function twoSchedules() {
  const { deps, ctx } = setupMembers();
  const older = unwrap(await saveFeeSchedule(deps, ctx, { validFrom: '2025-01-01', resolvedOn: '2024-11-20', rules: rules(deps, 1200) }));
  const newer = unwrap(await saveFeeSchedule(deps, ctx, { validFrom: '2026-01-01', rules: rules(deps, 1500), note: 'Beschluss der Versammlung' }));
  return { deps, ctx, older, newer };
}

/** Eine angelegte Beitragszeile ab `periodStart`, berechnet nach dem Stand `scheduleId` — macht ihn fest (M4). */
function createdCharge(deps: MembersDeps, periodStart: string, scheduleId: string) {
  const now = '2026-09-05T08:00:00.000Z';
  deps.db.insert(memberMemberships).values({ id: 'M1', contactId: 'C1', memberNumber: '0001', createdAt: now, updatedAt: now }).onConflictDoNothing().run();
  deps.db.insert(memberFeeCharges).values({ id: `F-${periodStart}`, membershipId: 'M1', periodStart, periodEnd: `${periodStart.slice(0, 4)}-12-31`, amountCents: 1500, dueOn: periodStart, state: 'created', scheduleId }).run();
}

describe('fee schedules', () => {
  it('lists stands newest first with their rules; feeRuleAt picks the stand of the day', async () => {
    const { deps, ctx } = await twoSchedules();
    const list = unwrap(await listFeeSchedules(deps, ctx, {}));
    expect(list.map((s) => s.validFrom)).toEqual(['2026-01-01', '2025-01-01']);
    expect(list[0]!.rules).toHaveLength(2);
    expect(list[0]!.rules.find((r) => r.minimum)!.allowedIntervals).toEqual(['monthly', 'yearly']);
    expect(list.every((s) => !s.locked)).toBe(true);
    const regular = typeId(deps, 'regular');
    expect(feeRuleAt(deps.db, regular, '2025-06-30')!.amountCents).toBe(1200);
    expect(feeRuleAt(deps.db, regular, '2026-01-01')!.amountCents).toBe(1500);
    expect(feeRuleAt(deps.db, regular, '2024-12-31')).toBeNull();
    expect(feeRuleAt(deps.db, typeId(deps, 'honorary'), '2026-03-01')).toBeNull();
  });

  it('audits create and update with the day only', async () => {
    const { deps, ctx, newer } = await twoSchedules();
    unwrap(await saveFeeSchedule(deps, ctx, { id: newer.id, validFrom: '2026-01-01', rules: rules(deps, 1800) }));
    expect(auditOf(deps, 'members.feeSchedule.create').map((e) => e.params)).toEqual([{ validFrom: '2025-01-01' }, { validFrom: '2026-01-01' }]);
    expect(auditOf(deps, 'members.feeSchedule.update').map((e) => e.params)).toEqual([{ validFrom: '2026-01-01' }]);
  });

  it('a stand with charges created after it is locked: no change, no delete', async () => {
    const { deps, ctx, newer, older } = await twoSchedules();
    createdCharge(deps, '2026-01-01', newer.id);
    createdCharge(deps, '2025-01-01', older.id);
    const list = unwrap(await listFeeSchedules(deps, ctx, {}));
    expect(list.map((s) => s.locked)).toEqual([true, true]);
    expect(fail(await saveFeeSchedule(deps, ctx, { id: newer.id, validFrom: '2026-01-01', rules: rules(deps, 1800) }))).toMatchObject({ type: 'conflict', code: 'feeScheduleLocked', params: { count: 1 } });
    expect(fail(await deleteFeeSchedule(deps, ctx, { id: older.id }))).toMatchObject({ code: 'feeScheduleLocked' });
  });

  it('a new resolution document must exist, be final and not voided; the stored one is not checked again', async () => {
    const { deps, ctx, newer } = await twoSchedules();
    const save = (c: CallContext, resolutionDocumentId: string) => saveFeeSchedule(deps, c, { id: newer.id, validFrom: '2026-01-01', resolutionDocumentId, rules: rules(deps, 1500) });
    expect(fail(await save(reading(ctx), 'NOPE'))).toMatchObject({ type: 'notFound' });
    expect(fail(await save(reading(ctx), resolutionDocument(deps, { phase: 'draft' })))).toMatchObject({ type: 'conflict', code: 'resolutionDocumentNotFinal' });
    expect(fail(await save(reading(ctx), resolutionDocument(deps, { status: 'voided' })))).toMatchObject({ type: 'conflict', code: 'resolutionDocumentVoided' });
    const good = resolutionDocument(deps);
    const feesOnly: CallContext = { ...ctx, permissions: new Set(['members.fees']) };
    expect(fail(await save(feesOnly, good))).toMatchObject({ type: 'forbidden' });
    unwrap(await save(reading(ctx), good));
    deps.db.update(documents).set({ status: 'voided' }).where(eq(documents.id, good)).run();
    unwrap(await save(feesOnly, good));
  });

  it('a locked stand takes the resolution afterwards, without touching its rules (Backlog 97)', async () => {
    const { deps, ctx, newer } = await twoSchedules();
    createdCharge(deps, '2026-01-01', newer.id);
    const ruleIdsBefore = deps.db.select().from(memberFeeRules).where(eq(memberFeeRules.scheduleId, newer.id)).all().map((r) => r.id).sort();
    const docId = resolutionDocument(deps);
    const saved = unwrap(await saveFeeSchedule(deps, reading(ctx), { id: newer.id, validFrom: '2026-01-01', resolvedOn: '2025-12-01', resolutionDocumentId: docId, note: 'Protokoll nachgetragen', rules: rules(deps, 1500) }));
    expect(saved).toMatchObject({ resolvedOn: '2025-12-01', resolutionDocumentId: docId, note: 'Protokoll nachgetragen', locked: true });
    expect(deps.db.select().from(memberFeeRules).where(eq(memberFeeRules.scheduleId, newer.id)).all().map((r) => r.id).sort()).toEqual(ruleIdsBefore);
    const entry = auditOf(deps, 'members.feeSchedule.update').at(-1)!;
    expect(entry.params).toEqual({ validFrom: '2026-01-01' });
    expect(JSON.parse(entry.before!)).toEqual({ resolvedOn: null, resolutionDocumentId: null, resolutionId: null, note: 'Beschluss der Versammlung' });
    expect(JSON.parse(entry.after!)).toEqual({ resolvedOn: '2025-12-01', resolutionDocumentId: docId, resolutionId: null, note: 'Protokoll nachgetragen' });
  });

  it('a locked stand: same rules in another order count as unchanged; any other change stays locked', async () => {
    const { deps, ctx, newer } = await twoSchedules();
    createdCharge(deps, '2026-01-01', newer.id);
    const base = rules(deps, 1500);
    expect((await saveFeeSchedule(deps, ctx, { id: newer.id, validFrom: '2026-01-01', resolvedOn: '2025-12-01', rules: [...base].reverse() })).ok).toBe(true);
    const changed = [
      { ...base[0]!, amountCents: 1501 },
      { ...base[0]!, interval: 'monthly' as const, allowedIntervals: ['monthly' as const] },
      { ...base[0]!, minimum: true },
      { ...base[0]!, admissionFeeCents: 500 },
    ];
    for (const rule of changed) {
      expect(fail(await saveFeeSchedule(deps, ctx, { id: newer.id, validFrom: '2026-01-01', rules: [rule, base[1]!] }))).toMatchObject({ code: 'feeScheduleLocked', params: { count: 1 } });
    }
    expect(fail(await saveFeeSchedule(deps, ctx, { id: newer.id, validFrom: '2026-01-01', rules: [{ ...base[1]!, allowedIntervals: ['monthly'] }, base[0]!] }))).toMatchObject({ code: 'feeScheduleLocked' });
    expect(fail(await saveFeeSchedule(deps, ctx, { id: newer.id, validFrom: '2026-01-01', rules: [base[0]!] }))).toMatchObject({ code: 'feeScheduleLocked' });
    expect(fail(await saveFeeSchedule(deps, ctx, { id: newer.id, validFrom: '2026-02-01', rules: base }))).toMatchObject({ code: 'feeScheduleLocked' });
  });

  it('a new stand next to a locked one is fine; the only stand cannot be deleted', async () => {
    const { deps, ctx, newer, older } = await twoSchedules();
    unwrap(await deleteFeeSchedule(deps, ctx, { id: older.id }));
    expect(auditOf(deps, 'members.feeSchedule.delete').map((e) => e.params)).toEqual([{ validFrom: '2025-01-01' }]);
    expect(fail(await deleteFeeSchedule(deps, ctx, { id: newer.id }))).toMatchObject({ code: 'feeScheduleLast' });
    createdCharge(deps, '2026-01-01', newer.id);
    expect((await saveFeeSchedule(deps, ctx, { validFrom: '2027-01-01', rules: rules(deps, 1800) })).ok).toBe(true);
  });

  it('refuses a rule for a fee-exempt type, an interval outside the allowed ones and a taken day', async () => {
    const { deps, ctx } = await twoSchedules();
    const honorary = { typeId: typeId(deps, 'honorary'), amountCents: 100, interval: 'yearly' as const, minimum: false, allowedIntervals: ['yearly' as const] };
    expect(fail(await saveFeeSchedule(deps, ctx, { validFrom: '2027-01-01', rules: [honorary] }))).toMatchObject({ type: 'validation', issues: [{ path: 'rules.0.typeId', message: 'feeExemptType' }] });
    const odd = { ...rules(deps, 1200)[0]!, allowedIntervals: ['monthly' as const] };
    expect(fail(await saveFeeSchedule(deps, ctx, { validFrom: '2027-01-01', rules: [odd] }))).toMatchObject({ type: 'validation' });
    expect(fail(await saveFeeSchedule(deps, ctx, { validFrom: '2026-01-01', rules: rules(deps, 1200) }))).toMatchObject({ type: 'conflict', code: 'feeScheduleDateTaken' });
  });

  it('needs members.fees to write and members.read to read', async () => {
    const { deps } = setupMembers(['members.read']);
    const { ctx: none } = setupMembers([]);
    expect(fail(await saveFeeSchedule(deps, none, { validFrom: '2027-01-01', rules: [] }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await listFeeSchedules(deps, none, {}))).toMatchObject({ type: 'forbidden' });
  });
});

/** Beschriftet Beschlüsse wie Gremien: `R1` gibt es, alles andere fehlt. */
/** Eckdaten wie aus Gremien (V-3): `R1` Beitragsordnung vom 20.11.2025, `R2` Rücklage, `R3` nicht festgeschrieben. */
const FACTS: Record<string, ResolutionFacts> = {
  R1: { kind: 'feeSchedule', final: true, outcome: 'adopted', decidedOn: '2025-11-20' },
  R2: { kind: 'reserve', final: true, outcome: 'adopted', decidedOn: '2025-11-20' },
  R3: { kind: 'feeSchedule', final: false, outcome: null, decidedOn: '2025-11-20' },
};
registerResolutionFactsSource((deps, _db, id) => (isModuleEnabled(deps, 'governance') ? (FACTS[id] ?? null) : null));
const resolutionsLike = defineModule({
  key: 'governance',
  version: '1',
  permissions: ['governance.read'],
  recordLabels: (_deps, _ctx, entityType, id) => (entityType !== 'governanceResolution' ? null : id === 'R1' ? { label: 'Beschluss B-2026-001', href: '/governance/resolutions/R1', state: 'ok' } : FACTS[id] ? { label: `Beschluss ${id}`, href: null, state: 'ok' } : { label: '', href: null, state: 'missing' }),
});

describe('fee schedule resolution from Gremien (G7)', () => {
  it('stores a known resolution with label and link, also on a locked stand; refuses an unknown one', async () => {
    const { deps, ctx } = setupMembers(undefined, { extraModules: [resolutionsLike] });
    const saved = unwrap(await saveFeeSchedule(deps, ctx, { validFrom: '2026-01-01', resolvedOn: '2025-11-20', resolutionId: 'R1', rules: rules(deps, 1500) }));
    expect(saved).toMatchObject({ resolutionId: 'R1', resolution: { label: 'Beschluss B-2026-001', href: '/governance/resolutions/R1' }, resolvedOn: '2025-11-20' });
    expect(fail(await saveFeeSchedule(deps, ctx, { validFrom: '2027-01-01', resolutionId: 'R9', rules: rules(deps, 1500) }))).toMatchObject({ type: 'validation', issues: [{ path: 'resolutionId', message: 'resolutionUnknown' }] });
    createdCharge(deps, '2026-01-01', saved.id);
    const locked = unwrap(await saveFeeSchedule(deps, ctx, { id: saved.id, validFrom: '2026-01-01', resolutionId: null, rules: rules(deps, 1500) }));
    expect(locked).toMatchObject({ locked: true, resolutionId: null, resolution: null });
    expect(JSON.parse(auditOf(deps, 'members.feeSchedule.update').at(-1)!.after!)).toMatchObject({ resolutionId: null });
  });

  it('V-3: only a sealed, adopted feeSchedule resolution; a different resolvedOn is flagged', async () => {
    const { deps, ctx } = setupMembers(undefined, { extraModules: [resolutionsLike] });
    expect(fail(await saveFeeSchedule(deps, ctx, { validFrom: '2026-01-01', resolutionId: 'R2', rules: rules(deps, 1500) }))).toMatchObject({ issues: [{ path: 'resolutionId', message: 'resolutionWrongKind', params: { expected: 'feeSchedule' } }] });
    expect(fail(await saveFeeSchedule(deps, ctx, { validFrom: '2026-01-01', resolutionId: 'R3', rules: rules(deps, 1500) }))).toMatchObject({ issues: [{ path: 'resolutionId', message: 'resolutionNotFinal' }] });
    const differs = unwrap(await saveFeeSchedule(deps, ctx, { validFrom: '2026-01-01', resolvedOn: '2025-11-21', resolutionId: 'R1', rules: rules(deps, 1500) }));
    expect(differs.warnings).toEqual([{ code: 'resolvedOnDiffers', params: { resolvedOn: '2025-11-21', decidedOn: '2025-11-20' } }]);
    const same = unwrap(await saveFeeSchedule(deps, ctx, { id: differs.id, validFrom: '2026-01-01', resolvedOn: '2025-11-20', resolutionId: 'R1', rules: rules(deps, 1500) }));
    expect(same.warnings).toEqual([]);
  });

  it('without Gremien a resolution id is unknown; the document field still works', async () => {
    const { deps, ctx } = setupMembers();
    expect(fail(await saveFeeSchedule(deps, ctx, { validFrom: '2026-01-01', resolutionId: 'R1', rules: rules(deps, 1500) }))).toMatchObject({ type: 'validation', issues: [{ path: 'resolutionId', message: 'resolutionUnknown' }] });
    expect(unwrap(await saveFeeSchedule(deps, ctx, { validFrom: '2026-01-01', rules: rules(deps, 1500) }))).toMatchObject({ resolutionId: null, resolution: null });
  });
});
