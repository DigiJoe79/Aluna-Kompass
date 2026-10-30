import { unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { GOVERNANCE_DEADLINE_KINDS, governanceDeadlinesInternal, listGovernanceDeadlines } from '../src/deadlines/list';
import { governanceModule } from '../src/manifest';
import { cancelMeeting, createMeeting } from '../src/meetings';
import { eq } from 'drizzle-orm';
import { governanceMeetings, governanceOffices, governanceOrgans } from '../src/schema';
import { createStatuteDraft, updateStatute } from '../src/statutes';
import { startTerm } from '../src/terms';
import { person, setupGovernance, type GovernanceDeps } from './helpers';

type Ctx = ReturnType<typeof setupGovernance>['ctx'];
const organ = (deps: GovernanceDeps, kind: 'assembly' | 'board') => deps.db.select().from(governanceOrgans).all().find((o) => o.kind === kind)!.id;

async function rules(deps: GovernanceDeps, ctx: Ctx, extra: Record<string, unknown> = {}) {
  const mv = organ(deps, 'assembly');
  const id = unwrap(await createStatuteDraft(deps, ctx, {})).id;
  unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on: '2026-01-20', resolutionId: null }], rules: { organs: { [mv]: { noticeDays: 14, motionDeadlineDays: 7, ...extra } } } }));
  return mv;
}

/** Alle Ämter besetzt seit 2026-01-01 (nichts fällig). */
async function fullOffices(deps: GovernanceDeps, ctx: Ctx) {
  for (const o of deps.db.select().from(governanceOffices).all()) for (let i = 0; i < o.seats; i += 1) unwrap(await startTerm(deps, ctx, { officeId: o.id, contactId: await person(deps, `P${o.id}${i}`), since: '2026-01-01', origin: 'backfilled' }));
}

describe('governanceDeadlinesInternal', () => {
  it('lists invite-by and motions-by for a planned meeting; overdue after the day', async () => {
    const { deps, ctx } = setupGovernance();
    await fullOffices(deps, ctx);
    const mv = await rules(deps, ctx);
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' }));
    const before = governanceDeadlinesInternal(deps, '2026-08-10');
    expect(before.map((d) => [d.kind, d.dueOn, d.overdue])).toEqual([
      ['inviteBy', '2026-08-18', false],
      ['motionsBy', '2026-08-28', false],
    ]);
    expect(before[0]).toMatchObject({ key: `inviteBy:${meeting.id}`, params: { heldOn: '2026-09-05', kind: 'ordinary' }, href: `/governance/meetings/${meeting.id}` });
    expect(before[1]).toMatchObject({ kind: 'motionsBy', href: `/governance/meetings/${meeting.id}` });
    expect(governanceDeadlinesInternal(deps, '2026-08-19').find((d) => d.kind === 'inviteBy')!.overdue).toBe(true);
    unwrap(await cancelMeeting(deps, ctx, { id: meeting.id, cancelledOn: '2026-08-20', reason: 'x' }));
    expect(governanceDeadlinesInternal(deps, '2026-08-20')).toEqual([]);
  });

  it('reminds of a missing ordinary assembly from 1 October by default, only with the rule and without a meeting that year', async () => {
    const { deps, ctx } = setupGovernance();
    await fullOffices(deps, ctx);
    const mv = await rules(deps, ctx, { ordinaryMeetingYearly: true });
    expect(governanceDeadlinesInternal(deps, '2026-09-30')).toEqual([]);
    expect(governanceDeadlinesInternal(deps, '2026-10-01').map((d) => [d.kind, d.dueOn])).toEqual([['ordinaryMeetingMissing', '2026-12-31']]);
    unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', heldOn: '2026-05-05', startsAt: '19:00', form: 'inPerson' }));
    expect(governanceDeadlinesInternal(deps, '2026-10-01')).toEqual([]);
  });

  it('takes the day of the reminder from governance.ordinaryMeetingWarnFrom', async () => {
    const { deps, ctx } = setupGovernance();
    await fullOffices(deps, ctx);
    await rules(deps, ctx, { ordinaryMeetingYearly: true });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'governance.ordinaryMeetingWarnFrom', '09-15'));
    expect(governanceDeadlinesInternal(deps, '2026-09-14')).toEqual([]);
    expect(governanceDeadlinesInternal(deps, '2026-09-15').map((d) => d.kind)).toEqual(['ordinaryMeetingMissing']);
  });

  it('reports a vacant seat, an ending term and a leaderless board', async () => {
    const { deps, ctx } = setupGovernance();
    const chair = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'chair')!;
    unwrap(await startTerm(deps, ctx, { officeId: chair.id, contactId: await person(deps), since: '2025-01-01', origin: 'backfilled' }));
    const kinds = governanceDeadlinesInternal(deps, '2026-09-01').map((d) => d.kind);
    expect(kinds).toContain('termEnding');
    expect(kinds).toContain('seatVacant');
    expect(kinds).not.toContain('boardLeaderless');
  });
});

describe('V-11: a substitute appointment is due for election, not „ending“ without a day', () => {
  it('electionDue on the day of the next assembly, without one without a day; never termEnding with an empty day', async () => {
    const { deps, ctx } = setupGovernance();
    const treasurer = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'treasurer')!;
    const term = unwrap(await startTerm(deps, ctx, { officeId: treasurer.id, contactId: await person(deps, 'Ersatz'), since: '2026-06-01', origin: 'substitute' }));
    const of = (day: string) => governanceDeadlinesInternal(deps, day).filter((d) => d.key.endsWith(term.id));
    expect(of('2026-09-01')).toEqual([expect.objectContaining({ key: `electionDue:${term.id}`, kind: 'electionDue', dueOn: null, overdue: false, params: { office: treasurer.name } })]);
    const assembly = deps.db.select().from(governanceOrgans).all().find((o) => o.kind === 'assembly')!;
    unwrap(await createMeeting(deps, ctx, { organId: assembly.id, kind: 'ordinary', heldOn: '2026-11-20', startsAt: '19:00', form: 'inPerson' }));
    expect(of('2026-09-01')).toEqual([expect.objectContaining({ kind: 'electionDue', dueOn: '2026-11-20' })]);
    // W-6: Eine schon gehaltene (beendete) Versammlung ist nicht die nächste.
    const held = unwrap(await createMeeting(deps, ctx, { organId: assembly.id, kind: 'extraordinary', heldOn: '2026-09-01', startsAt: '08:00', form: 'inPerson' }));
    deps.db.update(governanceMeetings).set({ startedAt: '2026-09-01T06:00:00.000Z', endedAt: '2026-09-01T07:00:00.000Z' }).where(eq(governanceMeetings.id, held.id)).run();
    expect(of('2026-09-01')).toEqual([expect.objectContaining({ kind: 'electionDue', dueOn: '2026-11-20' })]);
  });
});

describe('listGovernanceDeadlines and the tile', () => {
  it('needs governance.read; the tile is on by default and loads the list', async () => {
    const { deps, ctx, userId } = setupGovernance();
    await rules(deps, ctx);
    expect(await listGovernanceDeadlines(deps, ctxWith([], userId), {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await listGovernanceDeadlines(deps, ctx, {})).toMatchObject({ ok: true });
    const tile = governanceModule.dashboardTiles!.find((t) => t.key === 'deadlines')!;
    expect(tile).toMatchObject({ permission: 'governance.read', kind: 'list', variant: 'due', defaultOn: true });
    const content = await tile.load(deps, ctx, {});
    expect(content).toMatchObject({ kind: 'list', href: null });
  });
});

describe('deadlines of the minutes and mandates (G4)', () => {
  it('a recorded meeting without seal shows from day 29; an open mandate after its day is overdue', async () => {
    const { textPdf } = await import('@kompass/module-dms');
    const { endMeeting } = await import('../src/session');
    const { fileSignedMinutes } = await import('../src/minutes/signed');
    const { sealMeeting } = await import('../src/seal/seal');
    const { adopt, RECORDING, session } = await import('./helpers');
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['mandate'], voters: 2 });
    await adopt(deps, ctx, items[0]!.id, { details: { organId: organ(deps, 'board'), officeId: null, dueOn: '2026-10-01', task: 'Angebote einholen' } });
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    const of = (day: string, kind: string) => governanceDeadlinesInternal(deps, day).filter((d) => d.kind === kind);
    expect(of('2026-10-03', 'minutesUnsigned')).toEqual([]);
    expect(of('2026-10-04', 'minutesUnsigned')).toEqual([{ key: `minutesUnsigned:${meeting.id}`, kind: 'minutesUnsigned', dueOn: '2026-10-03', overdue: true, params: { heldOn: '2026-09-05', kind: 'ordinary' }, href: `/governance/meetings/${meeting.id}` }]);
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    expect(of('2026-10-04', 'minutesUnsigned')).toEqual([]);
    expect(of('2026-09-30', 'mandate')).toMatchObject([{ kind: 'mandate', dueOn: '2026-10-01', overdue: false, params: { number: 'B-2026-001' } }]);
    expect(of('2026-10-02', 'mandate')).toMatchObject([{ overdue: true }]);
    expect(governanceModule.dashboardTiles?.[0]?.messageKeys).toEqual(expect.arrayContaining(['minutesUnsigned', 'mandate']));
  });

  it('declares a text for every kind — the overview page lists all of them with these texts', () => {
    // Die Kachel zeigt `ordinaryMeetingMissing` nicht (eigene Kachel), die Übersicht der Gremien schon: Ohne Text brach
    // sie ab 01.10. mit MISSING_MESSAGE ab (Abnahme Test 30.10.).
    expect(governanceModule.dashboardTiles?.[0]?.messageKeys).toEqual([...GOVERNANCE_DEADLINE_KINDS]);
  });
});

describe('targets of the deadlines and the circular deadline (U2)', { timeout: 30_000 }, () => {
  it('every deadline the seed produces has a target, on several days of the year', async () => {
    const { fakeMailTransport } = await import('@kompass/core/testing');
    const { membersModule } = await import('@kompass/module-members');
    const { seedGovernance } = await import('../src/seed');
    const all = ['governance.read', 'governance.manage', 'governance.record', 'contacts.view', 'contacts.manage', 'members.read', 'members.manage', 'members.fees', 'dms.view', 'dms.create', 'dms.send'];
    const { deps, userId } = setupGovernance(all, { now: '2026-09-05T08:00:00.000Z', mail: fakeMailTransport() });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.mail.fromAddress', 'verein@example.org'));
    const ctx = ctxWith(all, userId);
    await membersModule.seed!(deps, ctx);
    await seedGovernance(deps, ctx);
    const found = ['2026-09-05', '2026-10-02', '2026-12-20', '2027-03-01'].flatMap((day) => governanceDeadlinesInternal(deps, day));
    expect(found.length).toBeGreaterThan(3);
    expect(found.filter((d) => d.href === null).map((d) => d.kind)).toEqual([]);
  });

  it('an open circular is due on its deadline; a decided one is not', async () => {
    const { createCircular, decideCircular } = await import('../src/circulars');
    const { holders } = await import('./helpers');
    const { deps, ctx } = setupGovernance();
    const [chair] = await holders(deps, ctx, ['chair', 'board']);
    const board = organ(deps, 'board');
    const open = unwrap(await createCircular(deps, ctx, { organId: board, kind: 'simple', text: 'Anschaffung', requestedOn: '2026-09-01', deadline: '2026-09-10', channel: 'email' }));
    const decided = unwrap(await createCircular(deps, ctx, { organId: board, kind: 'simple', text: 'Andere', requestedOn: '2026-09-01', deadline: '2026-09-12', channel: 'email' }));
    unwrap(await decideCircular(deps, ctx, { id: decided.id, outcome: 'rejected', decidedOn: '2026-09-04', decidedByContactId: chair!, outcomeReason: 'Zu teuer' }));
    const due = governanceDeadlinesInternal(deps, '2026-09-11').filter((d) => d.kind === 'circularDue');
    expect(due).toEqual([{ key: `circularDue:${open.id}`, kind: 'circularDue', dueOn: '2026-09-10', overdue: true, params: { requestedOn: '2026-09-01' }, href: `/governance/circulars/${open.id}` }]);
  });
});

describe('tiles deadlines and ordinaryMeeting (U2)', () => {
  it('the deadlines tile leaves out the missing ordinary assembly; the warning tile carries it until a meeting is set', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-10-02T08:00:00.000Z' });
    await fullOffices(deps, ctx);
    const mv = await rules(deps, ctx, { ordinaryMeetingYearly: true });
    const deadlines = governanceModule.dashboardTiles!.find((t) => t.key === 'deadlines')!;
    const warning = governanceModule.dashboardTiles!.find((t) => t.key === 'ordinaryMeeting')!;
    expect(warning).toMatchObject({ kind: 'status', warningAction: true, defaultOn: true, permission: 'governance.read' });
    expect(await deadlines.load(deps, ctx, {})).toMatchObject({ kind: 'list', lines: [] });
    expect(await warning.load(deps, ctx, {})).toEqual({ kind: 'status', tone: 'warning', messageKey: 'missing', values: { year: 2026, reference: 'none' }, href: `/governance/meetings/new?organ=${mv}&kind=ordinary` });
    unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', heldOn: '2026-11-20', startsAt: '19:00', form: 'inPerson' }));
    expect(await warning.load(deps, ctx, {})).toEqual({ kind: 'status', tone: 'neutral', messageKey: 'fine', values: { year: 2026 }, href: '/governance/meetings' });
  });
});
