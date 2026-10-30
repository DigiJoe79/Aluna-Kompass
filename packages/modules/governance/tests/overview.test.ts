import { unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext as systemContextFor } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { cancelMeeting, createMeeting } from '../src/meetings';
import { governanceMeetings } from '../src/schema';
import { getGovernanceOverview } from '../src/overview';
import { createStatuteDraft, registerStatute, updateStatute } from '../src/statutes';
import { startTerm } from '../src/terms';
import { officeOf, organOf, person, setupGovernance, withRules } from './helpers';

describe('getGovernanceOverview', () => {
  it('one row per seat: an auditor office with two seats and one holder has a vacant second row', async () => {
    const { deps, ctx } = setupGovernance();
    const auditor = officeOf(deps, 'auditor');
    const holder = await person(deps, 'Prüferin');
    unwrap(await startTerm(deps, ctx, { officeId: auditor, contactId: holder, since: '2025-05-06', origin: 'backfilled' }));
    const overview = unwrap(await getGovernanceOverview(deps, ctx, {}));
    const seats = overview.organs.find((o) => o.kind === 'assembly')!.seats.filter((s) => s.officeId === auditor);
    expect(seats).toHaveLength(2);
    expect(seats[0]).toMatchObject({ seat: 1, contactId: holder, name: 'Erika Prüferin', until: '2027-05-05', untilSuccessor: true, mark: null });
    expect(seats[1]).toMatchObject({ seat: 2, contactId: null, termId: null, mark: { kind: 'vacant' } });
    expect(overview.vacantSeats).toBeGreaterThanOrEqual(1);
  });

  it('a term ending within six months is marked with its day; one ending in eight months is not; an expired term until the successor stays', async () => {
    const { deps, ctx } = setupGovernance();
    const [chair, deputy, treasurer] = [officeOf(deps, 'chair'), officeOf(deps, 'board'), officeOf(deps, 'treasurer')];
    unwrap(await startTerm(deps, ctx, { officeId: chair, contactId: await person(deps, 'Vier'), since: '2025-01-06', origin: 'backfilled' }));
    unwrap(await startTerm(deps, ctx, { officeId: deputy, contactId: await person(deps, 'Acht'), since: '2025-05-06', origin: 'backfilled' }));
    unwrap(await startTerm(deps, ctx, { officeId: treasurer, contactId: await person(deps, 'Alt'), since: '2024-01-02', origin: 'backfilled' }));
    const board = unwrap(await getGovernanceOverview(deps, ctx, {})).organs.find((o) => o.kind === 'board')!;
    const of = (officeId: string) => board.seats.find((s) => s.officeId === officeId)!;
    expect(of(chair).mark).toEqual({ kind: 'termEnding', on: '2027-01-05' });
    expect(of(deputy).mark).toBeNull();
    expect(of(treasurer)).toMatchObject({ name: 'Erika Alt', until: '2026-01-01', mark: { kind: 'termEnding', on: '2026-01-01' } });
    expect(board.representation).toMatchObject({ source: 'law', value: { mode: 'majority' } });
    expect(board.voting).toBe(3);
  });

  it('a substitute until the next election is marked as due for election, not as ending without a day (V-11)', async () => {
    const { deps, ctx } = setupGovernance();
    const treasurer = officeOf(deps, 'treasurer');
    unwrap(await startTerm(deps, ctx, { officeId: treasurer, contactId: await person(deps, 'Ersatz'), since: '2026-07-01', origin: 'substitute' }));
    const board = unwrap(await getGovernanceOverview(deps, ctx, {})).organs.find((o) => o.kind === 'board')!;
    expect(board.seats.find((s) => s.officeId === treasurer)!.mark).toEqual({ kind: 'electionDue', on: null });
  });

  it('marks a person holding two incompatible offices', async () => {
    const { deps, ctx } = setupGovernance();
    const same = await person(deps, 'Doppelt');
    unwrap(await startTerm(deps, ctx, { officeId: officeOf(deps, 'treasurer'), contactId: same, since: '2026-01-01', origin: 'backfilled' }));
    unwrap(await startTerm(deps, ctx, { officeId: officeOf(deps, 'auditor'), contactId: same, since: '2026-01-01', origin: 'backfilled' }));
    const seats = unwrap(await getGovernanceOverview(deps, ctx, {})).organs.flatMap((o) => o.seats).filter((s) => s.contactId === same);
    expect(seats.map((s) => s.mark?.kind)).toEqual(['incompatible', 'incompatible']);
  });

  it('the next meeting is the earliest not cancelled from today', async () => {
    const { deps, ctx } = setupGovernance();
    const mv = organOf(deps, 'assembly');
    const cancelled = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'extraordinary', heldOn: '2026-09-10', startsAt: '19:00', form: 'inPerson' }));
    unwrap(await cancelMeeting(deps, ctx, { id: cancelled.id, cancelledOn: '2026-09-05', reason: 'x' }));
    unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', heldOn: '2026-10-01', startsAt: '19:00', form: 'inPerson' }));
    const next = unwrap(await createMeeting(deps, ctx, { organId: organOf(deps, 'board'), kind: 'board', heldOn: '2026-09-20', startsAt: '18:00', form: 'virtual' }));
    unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', heldOn: '2026-08-01', startsAt: '19:00', form: 'inPerson' }));
    const overview = unwrap(await getGovernanceOverview(deps, ctx, {}));
    expect(overview.nextMeeting).toMatchObject({ id: next.id, heldOn: '2026-09-20', organName: 'Vorstand', state: 'planned' });
    expect(overview.statute).toBeNull();
  });

  it('W-6: a meeting already held (ended) is not the next one', async () => {
    const { deps, ctx } = setupGovernance();
    const mv = organOf(deps, 'assembly');
    const held = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'extraordinary', heldOn: '2026-09-20', startsAt: '19:00', form: 'inPerson' }));
    deps.db.update(governanceMeetings).set({ startedAt: '2026-09-20T17:00:00.000Z', endedAt: '2026-09-20T19:00:00.000Z' }).where(eq(governanceMeetings.id, held.id)).run();
    const planned = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', heldOn: '2026-10-01', startsAt: '19:00', form: 'inPerson' }));
    expect(unwrap(await getGovernanceOverview(deps, ctx, {})).nextMeeting).toMatchObject({ id: planned.id });
  });

  it('W-7: the statute is valid since its registration, not since its resolution', async () => {
    const { deps, ctx } = setupGovernance();
    const id = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on: '2025-03-20', resolutionId: null }] }));
    unwrap(await registerStatute(deps, ctx, { id, registeredOn: '2025-06-01' }));
    expect(unwrap(await getGovernanceOverview(deps, ctx, {})).statute).toEqual({ id, since: '2025-06-01' });
  });

  it('needs governance.read', async () => {
    const { deps, userId } = setupGovernance();
    expect(await getGovernanceOverview(deps, ctxWith([], userId), {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});

describe('roles and offices diverge (G-29, Spec § 3.4)', () => {
  it('counts running role rows of the board, treasury or audit that carry no term; ended ones and adopted ones do not count', async () => {
    const { systemContext } = await import('@kompass/core/testing');
    const { startRoleRowInternal } = await import('@kompass/module-contacts');
    const { adoptRoleRows } = await import('../src/terms');
    const { deps, ctx } = setupGovernance();
    const row = (contactId: string, role: string, since: string) => deps.db.transaction((tx) => startRoleRowInternal(tx, deps, systemContext(), { contactId, role, since, note: null }));
    const chair = row(await person(deps, 'Vorsitz'), 'board-member', '2025-04-29');
    row(await person(deps, 'Presse'), 'press', '2025-04-29');
    expect(unwrap(await getGovernanceOverview(deps, ctx, {})).rolesDiverge).toBe(1);
    unwrap(await adoptRoleRows(deps, ctx, { items: [{ rowId: chair, officeId: officeOf(deps, 'chair') }] }));
    expect(unwrap(await getGovernanceOverview(deps, ctx, {})).rolesDiverge).toBe(0);
  });
});

describe('MV approves the annual accounts: statute rules against finance (G7)', () => {
  const approves = (deps: Parameters<typeof withRules>[0], value: boolean) => deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContextFor(), 'finance.reports.assemblyApprovesAccounts', value));
  const accountsRule = { majorities: { accounts: { fraction: 'simple' as const, base: 'present' as const, abstentions: 'ignored' as const } } };

  it('warns when the rules of the assembly know majorities.accounts and finance says no — and the other way round', async () => {
    const { deps, ctx } = setupGovernance();
    await withRules(deps, ctx, { assembly: accountsRule }, '2026-01-10');
    approves(deps, false);
    expect(unwrap(await getGovernanceOverview(deps, ctx, {})).accountsApprovalMismatch).toEqual({ statuteApproves: true, basis: 'rules' });
    approves(deps, true);
    expect(unwrap(await getGovernanceOverview(deps, ctx, {})).accountsApprovalMismatch).toBeNull();

    const other = setupGovernance();
    await withRules(other.deps, other.ctx, { assembly: {} }, '2026-01-10');
    approves(other.deps, true);
    expect(unwrap(await getGovernanceOverview(other.deps, other.ctx, {})).accountsApprovalMismatch).toEqual({ statuteApproves: false, basis: 'rules' });
  });

  it('V-4: a sealed, adopted accounts resolution of the assembly also counts — without majorities.accounts and without a valid statute', async () => {
    const { textPdf } = await import('@kompass/module-dms');
    const { fileSignedMinutes } = await import('../src/minutes/signed');
    const { sealMeeting } = await import('../src/seal/seal');
    const { endMeeting } = await import('../src/session');
    const { adopt, RECORDING, session } = await import('./helpers');
    const { financeFiscalYears } = await import('@kompass/module-finance');
    const { deps, ctx } = setupGovernance(RECORDING);
    approves(deps, false);
    const { meeting, items } = await session(deps, ctx, { items: ['accounts'], voters: 3 });
    const yearId = deps.db.select().from(financeFiscalYears).all()[0]?.id ?? 'FY';
    await adopt(deps, ctx, items[0]!.id, { details: { fiscalYearId: yearId } });
    expect(unwrap(await getGovernanceOverview(deps, ctx, {})).accountsApprovalMismatch).toBeNull();
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    expect(unwrap(await getGovernanceOverview(deps, ctx, {})).accountsApprovalMismatch).toEqual({ statuteApproves: true, basis: 'resolution' });
    approves(deps, true);
    expect(unwrap(await getGovernanceOverview(deps, ctx, {})).accountsApprovalMismatch).toBeNull();
  });

  it('no valid statute: no warning, whatever finance says', async () => {
    const { deps, ctx } = setupGovernance();
    approves(deps, true);
    expect(unwrap(await getGovernanceOverview(deps, ctx, {})).accountsApprovalMismatch).toBeNull();
  });
});
