import { unwrap } from '@kompass/core';
import { ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { acceptElection, saveElectionRound } from '../src/elections';
import { endMeeting } from '../src/session';
import { auditOf, holders, officeOf, person, RECORDING, session, setupGovernance, withRules, type GovernanceDeps } from './helpers';

const twoRounds = { mode: 'single' as const, rounds: [{ fraction: 'simple' as const, base: 'present' as const, abstentions: 'ignored' as const }, { fraction: 'simple' as const, base: 'cast' as const, abstentions: 'ignored' as const }], runoff: true };
const round = (number: number, candidates: [string, number][], rest: { no?: number; abstain?: number; invalid?: number; unanimousContactId?: string | null; runoff?: boolean } = {}) => ({
  number,
  runoff: rest.runoff ?? false,
  candidates: candidates.map(([contactId, votes]) => ({ contactId, votes })),
  no: rest.no ?? 0,
  abstain: rest.abstain ?? 0,
  invalid: rest.invalid ?? 0,
  unanimousContactId: rest.unanimousContactId ?? null,
});
const candidates = async (deps: GovernanceDeps, n: number) => Promise.all(Array.from({ length: n }, (_, i) => person(deps, `Kandidat ${i}`)));

describe('saveElectionRound', () => {
  it('Aluna rule: first round majority of those present, second of votes cast', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { assembly: { election: twoRounds } });
    const { items } = await session(deps, ctx, { items: ['election'], voters: 7 });
    const [a, b] = await candidates(deps, 2);
    const officeId = officeOf(deps, 'chair');
    const first = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[0]!.id, officeId, votedAt: '19:30', round: round(1, [[a!, 3], [b!, 3]], { abstain: 1 }) }));
    expect(first).toMatchObject({ kind: 'election', rounds: [{ number: 1, reachedBy: [], needed: 4 }], runoffSuggested: null });
    const second = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[0]!.id, officeId, votedAt: '19:40', round: round(2, [[a!, 4], [b!, 2]], { abstain: 1 }) }));
    expect(second.id).toBe(first.id);
    expect(second.rounds.map((r) => r.reachedBy)).toEqual([[], [a]]);
    expect(auditOf(deps, 'governance.election.round').map((e) => e.params)).toEqual([
      { officeId, round: 1 },
      { officeId, round: 2 },
    ]);
  });

  it('suggests a runoff of the two strongest after a tie in the last round', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { assembly: { election: twoRounds } });
    const { items } = await session(deps, ctx, { items: ['election'], voters: 7 });
    const [a, b, c] = await candidates(deps, 3);
    const input = { agendaItemId: items[0]!.id, officeId: officeOf(deps, 'chair'), votedAt: '19:30' };
    unwrap(await saveElectionRound(deps, ctx, { ...input, round: round(1, [[a!, 3], [b!, 3], [c!, 1]]) }));
    const second = unwrap(await saveElectionRound(deps, ctx, { ...input, round: round(2, [[a!, 3], [b!, 3], [c!, 1]]) }));
    expect(second.runoffSuggested!.contactIds.slice().sort()).toEqual([a, b].sort());
  });

  it('two seats, three candidates: the two best; unanimous names the person', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { items } = await session(deps, ctx, { items: ['election', 'election'], voters: 7 });
    const [a, b, c] = await candidates(deps, 3);
    const audit = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[0]!.id, officeId: officeOf(deps, 'auditor'), votedAt: '19:30', round: round(1, [[a!, 6], [b!, 5], [c!, 2]]) }));
    expect(audit.rounds[0]!.reachedBy).toEqual([a, b]);
    const chair = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[1]!.id, officeId: officeOf(deps, 'chair'), votedAt: '19:40', round: round(1, [], { unanimousContactId: c! }) }));
    expect(chair.rounds[0]!.reachedBy).toEqual([c]);
  });

  it('G-1: two seats, the first round fills one, the runoff the other — only the runoff winner joins', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { assembly: { election: twoRounds } });
    const { items } = await session(deps, ctx, { items: ['election'], voters: 4 });
    const [s, b, h] = await candidates(deps, 3);
    const input = { agendaItemId: items[0]!.id, officeId: officeOf(deps, 'auditor') };
    const first = unwrap(await saveElectionRound(deps, ctx, { ...input, votedAt: '19:35', round: round(1, [[s!, 3], [b!, 2], [h!, 2]], { abstain: 1 }) }));
    expect(first.rounds[0]).toEqual({ number: 1, reachedBy: [s], needed: 3 });
    const second = unwrap(await saveElectionRound(deps, ctx, { ...input, votedAt: '19:45', round: round(2, [[b!, 1], [h!, 3]], { runoff: true }) }));
    expect(second.rounds[1]).toEqual({ number: 2, reachedBy: [h], needed: 3 });
    expect(second.winners).toEqual([s, h]);
  });

  it('G-1: with several seats a candidate needs a majority of the ballots, not of the yes and no', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { items } = await session(deps, ctx, { items: ['election'], voters: 5 });
    const [a, b, c] = await candidates(deps, 3);
    const view = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[0]!.id, officeId: officeOf(deps, 'auditor'), votedAt: '19:30', round: round(1, [[a!, 5], [b!, 2], [c!, 1]]) }));
    expect(view.rounds[0]).toEqual({ number: 1, reachedBy: [a], needed: 3 });
  });

  it('warns when the elected auditor chairs the board; refuses the second writer', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const [chairHolder] = await holders(deps, ctx, ['chair']);
    const { items } = await session(deps, ctx, { items: ['election'], voters: 3 });
    const input = { agendaItemId: items[0]!.id, officeId: officeOf(deps, 'auditor'), votedAt: '19:30', round: round(1, [], { unanimousContactId: chairHolder! }) };
    expect(unwrap(await saveElectionRound(deps, ctx, input)).warnings).toContain('incompatible');
    const other = ctxWith(RECORDING, insertUser(deps, { name: 'B', email: 'b@kompass.local' }));
    expect(await saveElectionRound(deps, other, input)).toMatchObject({ ok: false, error: { code: 'notWriter' } });
    expect(await saveElectionRound(deps, ctxWith(['governance.read'], ctx.userId!), input)).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await saveElectionRound(deps, ctx, { ...input, votedAt: 'jetzt' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});

describe('acceptElection', () => {
  it('accepts on the meeting day by default, later with a date after the meeting ended', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: '2026-09-20T08:00:00.000Z' });
    const { items, meeting } = await session(deps, ctx, { items: ['election'], voters: 3 });
    const [a, b] = await candidates(deps, 2);
    const officeId = officeOf(deps, 'auditor');
    const r = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[0]!.id, officeId, votedAt: '19:30', round: round(1, [[a!, 3], [b!, 3]]) }));
    expect(unwrap(await acceptElection(deps, ctx, { resolutionId: r.id, contactId: a! })).details).toMatchObject({ elected: [{ contactId: a, acceptedOn: '2026-09-05', declinedOn: null }] });
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    const later = unwrap(await acceptElection(deps, ctx, { resolutionId: r.id, contactId: b!, acceptedOn: '2026-09-12' }));
    expect((later.details as { elected: unknown[] }).elected).toEqual([
      { contactId: a, acceptedOn: '2026-09-05', declinedOn: null },
      { contactId: b, acceptedOn: '2026-09-12', declinedOn: null },
    ]);
    expect(auditOf(deps, 'governance.election.accept').at(-1)!.params).toEqual({ officeId, contactId: b, acceptedOn: '2026-09-12', declined: false });
    expect(await acceptElection(deps, ctx, { resolutionId: r.id, contactId: await person(deps, 'Fremd') })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});

describe('acceptElection — dates (G-14)', () => {
  it('refuses an acceptance dated after today and before the meeting', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: '2026-09-06T10:00:00.000Z' });
    const { items } = await session(deps, ctx, { items: ['election'], voters: 3 });
    const [a] = await candidates(deps, 1);
    const r = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[0]!.id, officeId: officeOf(deps, 'chair'), votedAt: '19:30', round: round(1, [], { unanimousContactId: a! }) }));
    expect(await acceptElection(deps, ctx, { resolutionId: r.id, contactId: a!, acceptedOn: '2026-09-07' })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'acceptedOn', message: 'inFuture' }] } });
    expect(await acceptElection(deps, ctx, { resolutionId: r.id, contactId: a!, acceptedOn: '2026-09-04' })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'acceptedOn', message: 'beforeMeeting' }] } });
    expect(await acceptElection(deps, ctx, { resolutionId: r.id, contactId: a!, acceptedOn: '2026-09-06' })).toMatchObject({ ok: true });
  });
});

describe('W-5: remuneration in the same meeting', () => {
  it('proposes to exclude who was elected and accepted the office earlier in the meeting', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { items } = await session(deps, ctx, { items: ['election', 'remuneration'], voters: 3 });
    const [elected] = await candidates(deps, 1);
    const officeId = officeOf(deps, 'board');
    const election = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[0]!.id, officeId, votedAt: '18:45', round: round(1, [], { unanimousContactId: elected! }) }));
    unwrap(await acceptElection(deps, ctx, { resolutionId: election.id, contactId: elected! }));
    const { saveResolution } = await import('../src/resolutions');
    const { organOf } = await import('./helpers');
    const pay = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[1]!.id, text: 'Pauschale', votedAt: '19:10', unanimous: true, details: { statuteReference: null, decidedByOrganId: organOf(deps, 'assembly'), officeIds: [officeId], mode: 'flat', amountCents: 84000, validFrom: '2027-01-01' } }));
    expect(pay.excluded).toEqual([{ contactId: elected, reason: 'remuneration', note: null }]);
  });
});

describe('K-1: only winners declare', () => {
  async function runoffLost() {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { assembly: { election: twoRounds } });
    const { items, meeting } = await session(deps, ctx, { items: ['election'], voters: 4 });
    const [s, b, h] = await candidates(deps, 3);
    const input = { agendaItemId: items[0]!.id, officeId: officeOf(deps, 'auditor') };
    unwrap(await saveElectionRound(deps, ctx, { ...input, votedAt: '19:35', round: round(1, [[s!, 3], [b!, 2], [h!, 2]], { abstain: 1 }) }));
    const view = unwrap(await saveElectionRound(deps, ctx, { ...input, votedAt: '19:45', round: round(2, [[b!, 1], [h!, 3]], { runoff: true }) }));
    return { deps, ctx, meeting, view, s: s!, b: b!, h: h! };
  }

  it('refuses acceptance and refusal by a candidate who lost', async () => {
    const { deps, ctx, view, b } = await runoffLost();
    expect(await acceptElection(deps, ctx, { resolutionId: view.id, contactId: b })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'contactId', message: 'notElected' }] } });
    expect(await acceptElection(deps, ctx, { resolutionId: view.id, contactId: b, declined: true })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'contactId', message: 'notElected' }] } });
  });

  it('a stored declaration of a loser changes neither view, minutes nor seal preview', async () => {
    const { deps, ctx, meeting, view, s, b, h } = await runoffLost();
    unwrap(await acceptElection(deps, ctx, { resolutionId: view.id, contactId: s }));
    unwrap(await acceptElection(deps, ctx, { resolutionId: view.id, contactId: h }));
    const { governanceResolutions } = await import('../src/schema');
    const { eq } = await import('drizzle-orm');
    const row = deps.db.select().from(governanceResolutions).where(eq(governanceResolutions.id, view.id)).get()!;
    const details = row.details as { elected: unknown[] };
    deps.db.update(governanceResolutions).set({ details: { ...details, elected: [...details.elected, { contactId: b, acceptedOn: '2026-09-05', declinedOn: null }] } }).where(eq(governanceResolutions.id, view.id)).run();
    const { electionViewInternal } = await import('../src/elections');
    expect(electionViewInternal(deps.db, deps, deps.db.select().from(governanceResolutions).where(eq(governanceResolutions.id, view.id)).get()!).warnings).not.toContain('seatsExceeded');
    const { composeMinutesInternal, contactNameInternal } = await import('../src/minutes/compose');
    const { MINUTES_WORDS } = await import('../src/minutes/words');
    const loser = contactNameInternal(deps.db, b)!;
    const paragraphs = composeMinutesInternal(deps.db, deps, meeting.id).items.flatMap((i) => i.paragraphs);
    expect(paragraphs).not.toContain(MINUTES_WORDS.accepted(loser, 'Kassenprüfung', '2026-09-05'));
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    const { previewSeal } = await import('../src/seal/preview');
    const preview = unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id }));
    expect(preview.consequences.filter((c) => c.kind === 'startTerm').map((c) => c.params.contactId).sort()).toEqual([s, h].sort());
    expect(preview.blockers).not.toContain('officeFull');
  });
});

describe('K-4: runoff for the last open seat', () => {
  it('suggests a runoff when one seat is filled and two tie for the other', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { assembly: { election: { ...twoRounds, rounds: [twoRounds.rounds[0]!] } } });
    const { items } = await session(deps, ctx, { items: ['election'], voters: 5 });
    const [e, k, s] = await candidates(deps, 3);
    const view = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[0]!.id, officeId: officeOf(deps, 'auditor'), votedAt: '19:35', round: round(1, [[e!, 4], [k!, 2], [s!, 2]], { abstain: 1 }) }));
    expect(view.winners).toEqual([e]);
    expect(view.runoffSuggested!.contactIds.slice().sort()).toEqual([k, s].sort());
  });
});

describe('L-2: a corrected round drops the declaration of who is no longer elected', () => {
  it('removes it from details.elected (audited), so exclusions and every reader see only winners', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { items } = await session(deps, ctx, { items: ['election', 'remuneration'], voters: 5 });
    const [s, w] = await candidates(deps, 2);
    const officeId = officeOf(deps, 'board');
    const input = { agendaItemId: items[0]!.id, officeId, votedAt: '19:30' };
    const first = unwrap(await saveElectionRound(deps, ctx, { ...input, round: round(1, [[s!, 4], [w!, 1]]) }));
    unwrap(await acceptElection(deps, ctx, { resolutionId: first.id, contactId: s! }));
    const corrected = unwrap(await saveElectionRound(deps, ctx, { ...input, round: round(1, [[w!, 4], [s!, 1]]) }));
    expect(corrected.winners).toEqual([w]);
    expect((corrected.details as { elected: { contactId: string }[] }).elected).toEqual([]);
    const dropped = auditOf(deps, 'governance.election.declarationDropped');
    expect(dropped.map((e) => e.params)).toEqual([{ officeId, contactId: s }]);
    const { saveResolution } = await import('../src/resolutions');
    const { organOf } = await import('./helpers');
    const pay = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[1]!.id, text: 'Pauschale', votedAt: '19:40', unanimous: true, details: { statuteReference: null, decidedByOrganId: organOf(deps, 'assembly'), officeIds: [officeId], mode: 'flat', amountCents: 84000, validFrom: '2027-01-01' } }));
    expect(pay.excluded.map((e) => e.contactId)).not.toContain(s);
  });
});
