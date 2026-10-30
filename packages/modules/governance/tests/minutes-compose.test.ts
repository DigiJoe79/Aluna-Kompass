import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { acceptElection, saveElectionRound } from '../src/elections';
import { composeMinutesInternal } from '../src/minutes/compose';
import { MINUTES_WORDS } from '../src/minutes/words';
import { majorityPhrase } from '../src/rules/words';
import { LAW_SIMPLE_MAJORITY } from '../src/rules/law';
import { decideResolution, saveResolution } from '../src/resolutions';
import { governanceOffices } from '../src/schema';
import { endMeeting } from '../src/session';
import { addressedPerson, minorMember, officeOf, person, RECORDING, session, setupGovernance } from './helpers';

describe('composeMinutesInternal', () => {
  it('writes results as sentences, elections with acceptance, attendance only as a number — no birth date, no street', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['simple', 'simple', 'election'], voters: 7 });
    const a = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'Der Verein kauft einen Anhänger.', votedAt: '19:10', votes: { yes: 7, no: 0, abstain: 0 } }));
    unwrap(await decideResolution(deps, ctx, { id: a.id, outcome: 'adopted' }));
    const b = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[1]!.id, text: 'Der Beitrag steigt.', votedAt: '19:20', yesComputed: true, votes: { no: 4, abstain: 0, invalid: 1 } }));
    unwrap(await decideResolution(deps, ctx, { id: b.id, outcome: 'rejected' }));
    // Die Gewählte ist ein Mitglied mit Geburtsdatum und Anschrift — beides gehört nicht ins Protokoll.
    const elected = (await minorMember(deps, await addressedPerson(deps, { lastName: 'Vormund' }), '2015-04-01')).contactId;
    const officeId = officeOf(deps, 'chair');
    const e = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[2]!.id, officeId, votedAt: '19:30', round: { number: 1, runoff: false, candidates: [], no: 0, abstain: 0, invalid: 0, unanimousContactId: elected } }));
    unwrap(await acceptElection(deps, ctx, { resolutionId: e.id, contactId: elected }));
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));

    const minutes = composeMinutesInternal(deps.db, deps, meeting.id);
    const office = deps.db.select().from(governanceOffices).all().find((o) => o.id === officeId)!;
    // Ein gezählter Beschluss nennt die nötige Zahl aus der Auswertung (7 abgegeben → 4; 6 abgegeben → 4).
    const required = (needed: number) => MINUTES_WORDS.required(majorityPhrase(LAW_SIMPLE_MAJORITY, 'assembly'), needed, '§ 32 Abs. 1 S. 3 BGB');
    expect(minutes.items[0]!.paragraphs).toEqual([MINUTES_WORDS.adopted('Die Versammlung', { yes: 7, no: 0, abstain: 0, invalid: 0 }, false, 'Der Verein kauft einen Anhänger.'), required(4)]);
    expect(minutes.items[1]!.paragraphs).toEqual([MINUTES_WORDS.rejected({ yes: 2, no: 4, abstain: 0, invalid: 1 }, true, 'Der Beitrag steigt.'), required(4)]);
    expect(minutes.items[2]!.paragraphs).toEqual([MINUTES_WORDS.electedUnanimously('Erika Kind'), MINUTES_WORDS.accepted('Erika Kind', office.name, '2026-09-05')]);
    expect(minutes.head.find((h) => h.label === MINUTES_WORDS.headAttendance)!.value).toBe(MINUTES_WORDS.attendanceHead(7, 8, 0, 0, 'assembly'));
    expect(minutes.items.every((i) => i.defects.length === 0)).toBe(true);
    expect(minutes.end).toBe(MINUTES_WORDS.end('21:00'));
    const all = JSON.stringify(minutes);
    for (const secret of ['2015', '01.04.2015', 'Lindenweg', '12345', 'Beispielstadt']) expect(all).not.toContain(secret);
  });

  it('names the board as subject and leaves an open acceptance open', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items, contactIds } = await session(deps, ctx, { kind: 'board', items: ['simple', 'election'] });
    const r = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'Wir drucken Flyer.', votedAt: '19:10', unanimous: true }));
    unwrap(await decideResolution(deps, ctx, { id: r.id, outcome: 'adopted' }));
    unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[1]!.id, officeId: officeOf(deps, 'auditor'), votedAt: '19:20', round: { number: 1, runoff: false, candidates: [{ contactId: contactIds[0]!, votes: 3 }], no: 0, abstain: 0, invalid: 0, unanimousContactId: null } }));
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '20:00' }));
    const minutes = composeMinutesInternal(deps.db, deps, meeting.id);
    expect(minutes.items[0]!.paragraphs).toEqual([MINUTES_WORDS.unanimous('Der Vorstand', 'Wir drucken Flyer.')]);
    const office = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'auditor')!;
    // W-8: Auch ein gezählter Wahlgang nennt, was nötig war.
    expect(minutes.items[1]!.paragraphs).toEqual([MINUTES_WORDS.candidateVotes('Erika Amt chair 0', 3), MINUTES_WORDS.required(majorityPhrase(LAW_SIMPLE_MAJORITY, 'board'), 2, '§ 32 Abs. 1 S. 3 BGB'), MINUTES_WORDS.notYetAccepted('Erika Amt chair 0', office.name)]);
  });
});

describe('composeMinutesInternal — admission of late motions (G-6)', () => {
  it('puts each admission vote where it happened and numbers it in that order', async () => {
    const { saveMotion } = await import('../src/motions');
    const { recordFloorMotion } = await import('../src/floor-motions');
    const { admitLateMotion } = await import('../src/meeting-items');
    const { meetingResolutionsInOrderInternal } = await import('../src/seal/preview');
    const { deps, ctx } = setupGovernance(RECORDING);
    let written = '';
    const { meeting, items } = await session(deps, ctx, {
      items: ['simple', 'simple'],
      voters: 4,
      prepare: async (meetingId) => {
        written = unwrap(await saveMotion(deps, ctx, { meetingId, receivedOn: '2026-09-04', text: 'Der Beitrag der Fördermitglieder sinkt.' })).id;
      },
    });
    const writtenAdmission = unwrap(await admitLateMotion(deps, ctx, { motionId: written, votedAt: '19:05', votes: { yes: 2, no: 2 }, kind: 'simple' })).admission;
    unwrap(await decideResolution(deps, ctx, { id: writtenAdmission.id, outcome: 'rejected' }));
    const first = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'Erster Beschluss.', votedAt: '19:10', unanimous: true }));
    unwrap(await decideResolution(deps, ctx, { id: first.id, outcome: 'adopted' }));
    const floor = unwrap(await recordFloorMotion(deps, ctx, { meetingId: meeting.id, text: 'Wir kaufen ein Zelt.', kind: 'simple', afterItemId: items[0]!.id }));
    const floorAdmission = unwrap(await admitLateMotion(deps, ctx, { motionId: floor.id, votedAt: '19:30', unanimous: true, kind: 'simple' })).admission;
    unwrap(await decideResolution(deps, ctx, { id: floorAdmission.id, outcome: 'adopted' }));
    const second = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[1]!.id, text: 'Zweiter Beschluss.', votedAt: '19:50', unanimous: true }));
    unwrap(await decideResolution(deps, ctx, { id: second.id, outcome: 'adopted' }));
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));

    const minutes = composeMinutesInternal(deps.db, deps, meeting.id);
    expect(minutes.findings.some((f) => f.includes('Der Beitrag der Fördermitglieder sinkt.'))).toBe(true);
    expect(minutes.items[0]!.paragraphs.some((p) => p.includes('Wir kaufen ein Zelt.'))).toBe(true);
    expect(meetingResolutionsInOrderInternal(deps.db, meeting.id).map((r) => r.id)).toEqual([writtenAdmission.id, first.id, floorAdmission.id, second.id]);
  });
});

describe('composeMinutesInternal — tie and counts of one (G-8, G-22)', () => {
  it('G-8: a tie the chair decided says so in the minutes', async () => {
    const { withRules } = await import('./helpers');
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { board: { tie: 'chairDecides' } });
    const { meeting, items } = await session(deps, ctx, { kind: 'board', items: ['simple'], boardFunctions: ['chair', 'board'] });
    const r = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'Wir kaufen ein Zelt.', votedAt: '19:30', votes: { yes: 1, no: 1, abstain: 0, invalid: 0 } }));
    unwrap(await decideResolution(deps, ctx, { id: r.id, outcome: 'adopted' }));
    expect(composeMinutesInternal(deps.db, deps, meeting.id).items[0]!.paragraphs).toContain(MINUTES_WORDS.tieDecided('board', 'adopted'));
  });

  it('G-22: a count of one never stands with a plural noun (generic over the counted phrases)', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items, contactIds } = await session(deps, ctx, { items: ['simple', 'election'], voters: 5 });
    const r = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'Text.', votedAt: '19:30', votes: { yes: 1, no: 1, abstain: 1, invalid: 1 }, excluded: [{ contactId: contactIds[0]!, reason: 'legalTransaction' }] }));
    unwrap(await decideResolution(deps, ctx, { id: r.id, outcome: 'rejected' }));
    const [a, b] = [contactIds[1]!, contactIds[2]!];
    unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[1]!.id, officeId: officeOf(deps, 'chair'), votedAt: '19:40', round: { number: 1, runoff: false, candidates: [{ contactId: a, votes: 1 }, { contactId: b, votes: 1 }], no: 1, abstain: 1, invalid: 0, unanimousContactId: null } }));
    const text = composeMinutesInternal(deps.db, deps, meeting.id).items.flatMap((i) => i.paragraphs).join('\n');
    expect(text).not.toMatch(/\b1 (Ja-Stimmen|Nein-Stimmen|Enthaltungen|Stimmen|ungültigen Stimmen|ungültige Stimmen|Stimmberechtigte waren)/);
    expect(text).not.toMatch(/Erforderlich waren die /);
  });

  it('W-8: a counted election round names what was required; a postponed vote keeps its count and the reason of the chair', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items, contactIds } = await session(deps, ctx, { items: ['election', 'simple'], voters: 5 });
    unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[0]!.id, officeId: officeOf(deps, 'chair'), votedAt: '19:10', round: { number: 1, runoff: false, candidates: [{ contactId: contactIds[0]!, votes: 4 }], no: 1, abstain: 0, invalid: 0, unanimousContactId: null } }));
    const p = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[1]!.id, text: 'Entlastung', votedAt: '19:20', votes: { yes: 4, no: 0, abstain: 1 } }));
    const postponed = unwrap(await decideResolution(deps, ctx, { id: p.id, outcome: 'postponed', outcomeReason: 'Der Prüfbericht lag nicht vor.' }));
    expect(postponed.warnings).toContain('outcomeAgainstCount');
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    const minutes = composeMinutesInternal(deps.db, deps, meeting.id);
    const required = MINUTES_WORDS.required(majorityPhrase(LAW_SIMPLE_MAJORITY, 'assembly'), 3, '§ 32 Abs. 1 S. 3 BGB');
    expect(minutes.items[0]!.paragraphs).toContain(required);
    expect(minutes.items[1]!.paragraphs).toEqual([MINUTES_WORDS.postponedVotes({ yes: 4, no: 0, abstain: 1, invalid: 0 }, false), required]);
    // Gegen die Zählung: Hinweis mit der Begründung der Leitung.
    expect(minutes.items[1]!.defects.join(' ')).toContain(MINUTES_WORDS.chairReason('Der Prüfbericht lag nicht vor.'));
  });
});


describe('K-6: several offices in one election item', () => {
  it('opens each office with its own line before the rounds', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['election'], voters: 3 });
    const [a, b] = [await person(deps, 'Erste'), await person(deps, 'Zweite')];
    const unanimous = (contactId: string) => ({ number: 1, runoff: false, candidates: [], no: 0, abstain: 0, invalid: 0, unanimousContactId: contactId });
    await saveElectionRound(deps, ctx, { agendaItemId: items[0]!.id, officeId: officeOf(deps, 'chair'), votedAt: '19:30', round: unanimous(a) });
    await saveElectionRound(deps, ctx, { agendaItemId: items[0]!.id, officeId: officeOf(deps, 'treasurer'), votedAt: '19:40', round: unanimous(b) });
    const names = deps.db.select().from(governanceOffices).all();
    const nameOf = (fn: string) => names.find((o) => o.function === fn)!.name;
    const paragraphs = composeMinutesInternal(deps.db, deps, meeting.id).items.find((i) => i.paragraphs.length > 0)!.paragraphs;
    const chairLine = paragraphs.indexOf(MINUTES_WORDS.electionOf(nameOf('chair')));
    const treasurerLine = paragraphs.indexOf(MINUTES_WORDS.electionOf(nameOf('treasurer')));
    expect(chairLine).toBeGreaterThanOrEqual(0);
    expect(treasurerLine).toBeGreaterThan(chairLine);
  });
});
