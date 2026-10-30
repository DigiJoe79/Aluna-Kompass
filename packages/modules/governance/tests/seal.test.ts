import { unwrap } from '@kompass/core';
import { contactRoles } from '@kompass/module-contacts';
import { textPdf } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createCircular, decideCircular, getCircular, saveCircularResponse } from '../src/circulars';
import { acceptElection, saveElectionRound } from '../src/elections';
import { getMeeting } from '../src/meeting-detail';
import { fileSignedMinutes } from '../src/minutes/signed';
import { governanceRegisterOccasions, governanceResolutionCounters, governanceResolutions, governanceTerms } from '../src/schema';
import { sealCircular, sealMeeting } from '../src/seal/seal';
import { previewSeal } from '../src/seal/preview';
import { endMeeting, reopenMeeting } from '../src/session';
import { adopt, asMcp, auditOf, elect, holders, officeOf, organOf, person, RECORDING, session, setupGovernance } from './helpers';

type Env = ReturnType<typeof setupGovernance>;
async function finish({ deps, ctx }: Env, meetingId: string) {
  unwrap(await endMeeting(deps, ctx, { meetingId, endedAt: '21:00' }));
  unwrap(await fileSignedMinutes(deps, ctx, { meetingId, bytes: textPdf(['Protokoll']) }));
}
const termsOf = (env: Env, officeId: string) => env.deps.db.select().from(governanceTerms).where(eq(governanceTerms.officeId, officeId)).all();
/** Eine Wahl mit mehreren Kandidaten (je drei Stimmen), alle nehmen am Sitzungstag an. */
async function electMany({ deps, ctx }: Env, agendaItemId: string, officeId: string, contactIds: string[]) {
  const r = unwrap(await saveElectionRound(deps, ctx, { agendaItemId, officeId, votedAt: '19:30', round: { number: 1, runoff: false, candidates: contactIds.map((contactId) => ({ contactId, votes: 3 })), no: 0, abstain: 0, invalid: 0, unanimousContactId: null } }));
  for (const contactId of contactIds) unwrap(await acceptElection(deps, ctx, { resolutionId: r.id, contactId }));
  return r;
}

describe('sealMeeting', () => {
  it('Abnahme 5: the elected starts with the acceptance, with role board-member and the office name; the predecessor ends the day before; numbers without gaps', async () => {
    const env = setupGovernance(RECORDING);
    const { deps, ctx } = env;
    const [old] = await holders(deps, ctx, ['chair'], '2024-09-05');
    const { meeting, items } = await session(deps, ctx, { items: ['simple', 'election'], voters: 3 });
    await adopt(deps, ctx, items[0]!.id);
    const successor = await person(deps, 'Nachfolgerin');
    const chairOffice = officeOf(deps, 'chair');
    const election = await elect(deps, ctx, items[1]!.id, chairOffice, successor);
    await finish(env, meeting.id);
    expect(await reopenMeeting(deps, ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { code: 'minutesFiled' } });
    expect(await sealMeeting(deps, asMcp(ctx), { meetingId: meeting.id })).toMatchObject({ ok: false, error: { code: 'humanOnly' } });

    const sealed = unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    expect(sealed.meeting.state).toBe('signed');
    const terms = termsOf(env, chairOffice);
    expect(terms.find((t) => t.contactId === old)).toMatchObject({ until: '2026-09-04', endReason: 'successor' });
    const started = terms.find((t) => t.contactId === successor)!;
    expect(started).toMatchObject({ since: '2026-09-05', origin: 'elected', acceptedOn: '2026-09-05', resolutionId: election.id });
    expect(deps.db.select().from(contactRoles).where(eq(contactRoles.contactId, successor)).all().map((r) => [r.role, r.since])).toEqual([['board-member', '2026-09-05']]);
    expect(deps.db.select().from(governanceResolutions).all().map((r) => r.number).sort()).toEqual(['B-2026-001', 'B-2026-002']);
    expect(auditOf(deps, 'governance.meeting.seal').at(-1)!.params).toEqual({ kind: 'ordinary', heldOn: '2026-09-05', resolutions: 2, terms: 1 });
    expect(auditOf(deps, 'governance.resolution.number').map((e) => e.params!.number)).toEqual(['B-2026-001', 'B-2026-002']);
    expect(await sealMeeting(deps, ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { code: 'meetingSealed' } });
  });

  // K-1: Nur Gewählte nehmen an — drei Annahmen für zwei Plätze entstehen erst über zwei Wahlen zum selben Amt.
  it('Review Focus 3: three acceptances in two elections for two seats — conflict officeFull, nothing numbered, nothing started, still recorded', async () => {
    const env = setupGovernance(RECORDING);
    const { deps, ctx } = env;
    await holders(deps, ctx, ['auditor', 'auditor'], '2026-01-01');
    const { meeting, items } = await session(deps, ctx, { items: ['simple', 'election', 'election'], voters: 3 });
    await adopt(deps, ctx, items[0]!.id);
    await electMany(env, items[1]!.id, officeOf(deps, 'auditor'), [await person(deps, 'Erste'), await person(deps, 'Zweite')]);
    await electMany(env, items[2]!.id, officeOf(deps, 'auditor'), [await person(deps, 'Dritte')]);
    await finish(env, meeting.id);
    expect(unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id })).blockers).toEqual(['officeFull']);
    expect(await sealMeeting(deps, ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { code: 'officeFull' } });
    expect(deps.db.select().from(governanceResolutions).all().every((r) => r.number === null)).toBe(true);
    expect(deps.db.select().from(governanceResolutionCounters).all()).toEqual([]);
    expect(termsOf(env, officeOf(deps, 'auditor'))).toHaveLength(2);
    expect(unwrap(await getMeeting(deps, ctx, { id: meeting.id })).state).toBe('recorded');
  });

  it('refuses without signed minutes; an absent candidate who accepts after sealing starts the term then', async () => {
    const env = setupGovernance(RECORDING, { now: '2026-09-20T08:00:00.000Z' });
    const { deps, ctx } = env;
    const { meeting, items } = await session(deps, ctx, { items: ['election'], voters: 3 });
    const absent = await person(deps, 'Abwesend');
    const auditor = officeOf(deps, 'auditor');
    const r = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[0]!.id, officeId: auditor, votedAt: '19:30', round: { number: 1, runoff: false, candidates: [], no: 0, abstain: 0, invalid: 0, unanimousContactId: absent } }));
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    expect(await sealMeeting(deps, ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { code: 'minutesMissing' } });
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    expect(termsOf(env, auditor)).toEqual([]);
    expect(deps.db.select().from(governanceResolutions).where(eq(governanceResolutions.id, r.id)).get()!.number).toBe('B-2026-001');
    unwrap(await acceptElection(deps, ctx, { resolutionId: r.id, contactId: absent, acceptedOn: '2026-09-12' }));
    expect(termsOf(env, auditor)).toEqual([expect.objectContaining({ contactId: absent, since: '2026-09-12', resolutionId: r.id, origin: 'elected' })]);
  });
});

describe('sealMeeting — new election before the term runs out (Spec § 6: the predecessor ends the day before)', () => {
  it('a chair elected before the scheduled end of the holder: the holder ends the day before with successor, a board change', async () => {
    const env = setupGovernance(RECORDING, { now: '2028-05-10T08:00:00.000Z' });
    const { deps, ctx } = env;
    const chairOffice = officeOf(deps, 'chair');
    const [a] = await holders(deps, ctx, ['chair'], '2026-07-20');
    const { meeting, items } = await session(deps, ctx, { items: ['election'], voters: 3, heldOn: '2028-05-10' });
    const b = await person(deps, 'Nachfolgerin');
    await elect(deps, ctx, items[0]!.id, chairOffice, b);
    await finish(env, meeting.id);
    const preview = unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id }));
    expect(preview.blockers).toEqual([]);
    expect(preview.consequences.find((c) => c.kind === 'endPredecessor')!.params).toMatchObject({ contactId: a, until: '2028-05-09', reason: 'successor' });
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    const terms = termsOf(env, chairOffice);
    expect(terms.find((t) => t.contactId === a)).toMatchObject({ until: '2028-05-09', endReason: 'successor' });
    expect(terms.find((t) => t.contactId === b)).toMatchObject({ since: '2028-05-10', until: null });
    expect(deps.db.select().from(governanceRegisterOccasions).all().map((o) => o.kind)).toEqual(['boardChange']);
  });

  it('with two seats the holder with the earlier scheduled end makes room; the other stays', async () => {
    const env = setupGovernance(RECORDING, { now: '2027-06-01T08:00:00.000Z' });
    const { deps, ctx } = env;
    const auditor = officeOf(deps, 'auditor');
    const [y] = await holders(deps, ctx, ['auditor'], '2027-01-01');
    const [x] = await holders(deps, ctx, ['auditor'], '2026-01-01');
    const { meeting, items } = await session(deps, ctx, { items: ['election'], voters: 3, heldOn: '2027-06-01' });
    const z = await person(deps, 'Neu');
    await elect(deps, ctx, items[0]!.id, auditor, z);
    await finish(env, meeting.id);
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    const terms = termsOf(env, auditor);
    expect(terms.find((t) => t.contactId === x)).toMatchObject({ until: '2027-05-31', endReason: 'successor' });
    expect(terms.find((t) => t.contactId === y)).toMatchObject({ until: null });
    expect(terms.find((t) => t.contactId === z)).toMatchObject({ since: '2027-06-01' });
  });

  it('re-election of the same person before the scheduled end: the old term ends the day before, no register occasion', async () => {
    const env = setupGovernance(RECORDING, { now: '2028-05-10T08:00:00.000Z' });
    const { deps, ctx } = env;
    const chairOffice = officeOf(deps, 'chair');
    const a = await person(deps, 'Vorsitzende');
    const first = await session(deps, ctx, { items: ['election'], voters: 3, heldOn: '2026-07-20' });
    await elect(deps, ctx, first.items[0]!.id, chairOffice, a);
    await finish(env, first.meeting.id);
    unwrap(await sealMeeting(deps, ctx, { meetingId: first.meeting.id }));
    const occasionsBefore = deps.db.select().from(governanceRegisterOccasions).all().length;
    const second = await session(deps, ctx, { items: ['election'], voters: 3, heldOn: '2028-05-10' });
    await elect(deps, ctx, second.items[0]!.id, chairOffice, a);
    await finish(env, second.meeting.id);
    const preview = unwrap(await previewSeal(deps, ctx, { meetingId: second.meeting.id }));
    expect(preview.consequences.map((c) => c.kind)).toEqual(['numberResolution', 'endPredecessor', 'startTerm']);
    unwrap(await sealMeeting(deps, ctx, { meetingId: second.meeting.id }));
    expect(termsOf(env, chairOffice).map((t) => [t.since, t.until])).toEqual(expect.arrayContaining([['2026-07-20', '2028-05-09'], ['2028-05-10', null]]));
    expect(deps.db.select().from(governanceRegisterOccasions).all()).toHaveLength(occasionsBefore);
  });
});

describe('sealCircular', () => {
  it('a circular with all consents becomes a numbered resolution; once', async () => {
    const env = setupGovernance();
    const { deps, ctx } = env;
    await holders(deps, ctx, ['chair', 'board', 'treasurer']);
    const circular = unwrap(await createCircular(deps, ctx, { organId: organOf(deps, 'board'), kind: 'simple', text: 'Laptop beschaffen', requestedOn: '2026-09-10', deadline: '2026-09-17', channel: 'email' }));
    expect(await sealCircular(deps, ctx, { circularId: circular.id })).toMatchObject({ ok: false, error: { code: 'outcomeMissing' } });
    for (const response of circular.responses) unwrap(await saveCircularResponse(deps, ctx, { id: response.id, answer: 'yes', answeredOn: '2026-09-11' }));
    unwrap(await decideCircular(deps, ctx, { id: circular.id, outcome: 'adopted', decidedOn: '2026-09-12', decidedByContactId: circular.responses[0]!.contactId! }));
    expect(await sealCircular(deps, asMcp(ctx), { circularId: circular.id })).toMatchObject({ ok: false, error: { code: 'humanOnly' } });
    const sealed = unwrap(await sealCircular(deps, ctx, { circularId: circular.id }));
    expect(sealed.resolution).toMatchObject({ circularId: circular.id, meetingId: null, number: 'B-2026-001', decidedOn: '2026-09-12', outcome: 'adopted', votes: { yes: 3, no: 0, abstain: 0, invalid: 0 } });
    expect(unwrap(await getCircular(deps, ctx, { id: circular.id })).sealedAt).not.toBeNull();
    expect(auditOf(deps, 'governance.circular.seal').at(-1)!.params).toEqual({ kind: 'simple', number: 'B-2026-001' });
    expect(await sealCircular(deps, ctx, { circularId: circular.id })).toMatchObject({ ok: false, error: { code: 'circularSealed' } });
  });
});

describe('W-10: a meeting dated after today', () => {
  it('may be begun (with a warning) but not sealed', async () => {
    const env = setupGovernance(RECORDING, { now: '2026-10-29T08:00:00.000Z' });
    const { deps, ctx } = env;
    const { meeting, items } = await session(deps, ctx, { items: ['simple'], voters: 3, heldOn: '2026-11-05' });
    await adopt(deps, ctx, items[0]!.id);
    await finish(env, meeting.id);
    expect(unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id })).blockers).toContain('meetingInFuture');
    expect(await sealMeeting(deps, ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'meetingInFuture' } });
  });
});
