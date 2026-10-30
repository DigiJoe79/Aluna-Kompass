import { unwrap } from '@kompass/core';
import { ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { setAgendaNote } from '../src/agenda-note';
import { getMeetingContext } from '../src/meeting-context';
import { composeMinutesInternal } from '../src/minutes/compose';
import { decideResolution, saveResolution } from '../src/resolutions';
import { endMeeting } from '../src/session';
import { auditOf, GOVERNANCE_PERMISSIONS, holders, RECORDING, session, setupGovernance, withRules } from './helpers';

const STATUTE_MAJORITY = { fraction: { num: 3, den: 4 }, base: 'cast', abstentions: 'ignored', comparison: 'atLeast' } as const;

describe('getMeetingContext', () => {
  it('G-17: an election item shows the majority of the first round from the statute', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const present = { fraction: 'simple', base: 'present', abstentions: 'ignored' } as const;
    await withRules(deps, ctx, { assembly: { election: { mode: 'single', rounds: [present, { fraction: 'simple', base: 'cast', abstentions: 'ignored' }], runoff: true } } });
    const { meeting, items } = await session(deps, ctx, { items: ['election'], voters: 3 });
    const context = unwrap(await getMeetingContext(deps, ctx, { meetingId: meeting.id }));
    expect(context.rules.majorities[items[0]!.id]).toMatchObject({ value: present, source: 'statute' });
    expect(context.rules.majorityByKind.election).toMatchObject({ value: present, source: 'statute' });
  });

  it('G-3: the terms running on the meeting day, with names, to choose whom a dismissal concerns', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const [treasurer] = await holders(deps, ctx, ['treasurer']);
    await holders(deps, ctx, ['chair'], '2026-10-01');
    const { meeting } = await session(deps, ctx, { items: ['dismissal'], voters: 1 });
    const context = unwrap(await getMeetingContext(deps, ctx, { meetingId: meeting.id }));
    expect(context.terms).toEqual([expect.objectContaining({ contactId: treasurer })]);
    expect(context.names[treasurer!]).toBeTruthy();
  });

  it('names, rules per item, sentences as in the draft, seal only when recorded, the writer', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { assembly: { majorities: { statute: STATUTE_MAJORITY } } });
    const { meeting, items, attendance } = await session(deps, ctx, { items: ['statute', 'simple', 'report'], voters: 3 });
    unwrap(await setAgendaNote(deps, ctx, { itemId: items[1]!.id, note: 'Kurze Aussprache.' }));
    const r = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[1]!.id, text: 'Der Verein kauft ein Zelt.', votedAt: '19:10', yesComputed: true, votes: { no: 1, abstain: 0, invalid: 0 } }));
    unwrap(await decideResolution(deps, ctx, { id: r.id, outcome: 'adopted' }));

    const running = unwrap(await getMeetingContext(deps, ctx, { meetingId: meeting.id }));
    for (const a of attendance) expect(running.names[a.contactId!]).toBeTruthy();
    expect(running.organ.kind).toBe('assembly');
    expect(running.rules.majorities[items[0]!.id]).toMatchObject({ value: STATUTE_MAJORITY, source: 'statute' });
    expect(running.rules.majorities[items[2]!.id]).toBeNull();
    expect(running.rules.assembly).toBe(true);
    expect(running.rules.allVoting).toBe(3);
    expect(running.statute).not.toBeNull();
    expect(running.seal).toBeNull();
    expect(running.writer).toEqual({ userId: ctx.userId, isCaller: true });

    const other = ctxWith(RECORDING, insertUser(deps, { name: 'Zweite', email: 'zweite@kompass.local' }));
    expect(unwrap(await getMeetingContext(deps, other, { meetingId: meeting.id })).writer.isCaller).toBe(false);

    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    const recorded = unwrap(await getMeetingContext(deps, ctx, { meetingId: meeting.id }));
    expect(recorded.seal).not.toBeNull();
    const minutes = composeMinutesInternal(deps.db, deps, meeting.id);
    expect(recorded.sentences[items[1]!.id]).toEqual(minutes.items[1]!.paragraphs.slice(1));
    expect(recorded.sentences[items[1]!.id]!.length).toBeGreaterThan(0);
    expect(auditOf(deps, 'governance.meeting.context')).toEqual([]);
  });

  it('forbidden without governance.read, validation without meetingId, notFound', async () => {
    const { deps, ctx } = setupGovernance(GOVERNANCE_PERMISSIONS);
    expect(await getMeetingContext(deps, ctxWith([], ctx.userId), { meetingId: 'x' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await getMeetingContext(deps, ctx, {})).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await getMeetingContext(deps, ctx, { meetingId: 'fehlt' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });
});
