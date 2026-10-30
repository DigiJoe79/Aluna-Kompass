import { unwrap } from '@kompass/core';
import { applyDispatchInternal, documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { proposeAgenda } from '../src/agenda-proposal';
import { saveFindings } from '../src/findings';
import { continueInvitationRun, startInvitationRun } from '../src/invitation/runs';
import { addMeetingItem } from '../src/meeting-items';
import { createMeeting } from '../src/meetings';
import { composeMinutesInternal } from '../src/minutes/compose';
import { meetingDefectsInternal } from '../src/minutes/defects';
import { MINUTES_WORDS } from '../src/minutes/words';
import { decideResolution, saveResolution } from '../src/resolutions';
import { governanceRunLetters } from '../src/schema';
import { addressedPerson, member, organOf, RECORDING, session, setupGovernance, withRules } from './helpers';

describe('meetingDefectsInternal', () => {
  it('a letter that arrived after the last day of receipt is noticeShort', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-08-10T08:00:00.000Z' });
    await withRules(deps, ctx, { assembly: { noticeDays: 14 } }, '2026-07-20');
    await member(deps, { contactId: await addressedPerson(deps) });
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), kind: 'ordinary', heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' }));
    unwrap(await proposeAgenda(deps, ctx, { meetingId: meeting.id }));
    const run = unwrap(await startInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'invitation' }));
    unwrap(await continueInvitationRun(deps, ctx, { runId: run.id }));
    const letter = deps.db.select().from(governanceRunLetters).all()[0]!.documentId;
    deps.db.transaction((tx) => applyDispatchInternal(tx, deps, ctx, tx.select().from(documents).where(eq(documents.id, letter)).get()!, { sentAt: '2026-08-19', sentVia: 'post', note: null }));
    expect(meetingDefectsInternal(deps.db, deps, meeting.id)).toEqual([{ kind: 'noticeShort', agendaItemId: null, reason: null }]);
  });

  it('L-5: notice short and a finding of a proper invitation against it make one defect with one reason', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: '2026-08-10T08:00:00.000Z' });
    await withRules(deps, ctx, { assembly: { noticeDays: 14 } }, '2026-07-20');
    await member(deps, { contactId: await addressedPerson(deps) });
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), kind: 'ordinary', heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' }));
    unwrap(await proposeAgenda(deps, ctx, { meetingId: meeting.id }));
    const run = unwrap(await startInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'invitation' }));
    unwrap(await continueInvitationRun(deps, ctx, { runId: run.id }));
    const letter = deps.db.select().from(governanceRunLetters).all()[0]!.documentId;
    deps.db.transaction((tx) => applyDispatchInternal(tx, deps, ctx, tx.select().from(documents).where(eq(documents.id, letter)).get()!, { sentAt: '2026-08-19', sentVia: 'post', note: null }));
    const { startMeeting } = await import('../src/session');
    unwrap(await startMeeting(deps, ctx, { meetingId: meeting.id }));
    unwrap(await saveFindings(deps, ctx, { meetingId: meeting.id, findings: { invitationProper: true, invitationNote: 'Alle hatten die Einladung rechtzeitig per Mail' } }));
    const defects = meetingDefectsInternal(deps.db, deps, meeting.id);
    expect(defects.filter((d) => d.reason === 'Alle hatten die Einladung rechtzeitig per Mail')).toHaveLength(1);
    expect(defects.map((d) => d.kind)).not.toContain('findingAgainstNotice');
  });

  it('a finding and an outcome against the count carry the reason and the note into the draft; a spontaneous statute item is notAnnounced', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { assembly: { quorum: { kind: 'absolute', count: 2 } } });
    const { meeting, items } = await session(deps, ctx, { items: ['simple'], voters: 3 });
    unwrap(await saveFindings(deps, ctx, { meetingId: meeting.id, findings: { quorate: false, quorumNote: 'Zwei Stimmkarten fehlten' } }));
    const r = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'Antrag', votedAt: '19:10', votes: { yes: 1, no: 2, abstain: 0 } }));
    unwrap(await decideResolution(deps, ctx, { id: r.id, outcome: 'adopted', outcomeReason: 'Eine Stimme war falsch gezählt' }));
    const statute = unwrap(await addMeetingItem(deps, ctx, { meetingId: meeting.id, kind: 'statute', title: 'Satzungsänderung' }));
    expect(meetingDefectsInternal(deps.db, deps, meeting.id)).toEqual([
      { kind: 'notInvited', agendaItemId: null, reason: null },
      { kind: 'findingAgainstCount', agendaItemId: null, reason: 'Zwei Stimmkarten fehlten' },
      { kind: 'outcomeAgainstCount', agendaItemId: items[0]!.id, reason: 'Eine Stimme war falsch gezählt' },
      { kind: 'notAnnounced', agendaItemId: statute.id, reason: null },
    ]);
    const minutes = composeMinutesInternal(deps.db, deps, meeting.id);
    expect(minutes.defects).toEqual([...MINUTES_WORDS.defect({ kind: 'notInvited', reason: null }), ...MINUTES_WORDS.defect({ kind: 'findingAgainstCount', reason: 'Zwei Stimmkarten fehlten' })]);
    // Plan U2: Mängel eines TOP stehen als eigener Absatz mit Randstrich, nicht unter den Sätzen.
    expect(minutes.items[0]!.defects).toEqual([MINUTES_WORDS.defect({ kind: 'outcomeAgainstCount', reason: 'Eine Stimme war falsch gezählt' }).join(' ')]);
    expect(minutes.items[0]!.defects[0]).toContain(MINUTES_WORDS.againstCountNote);
    expect(minutes.items[0]!.paragraphs.join(' ')).not.toContain(MINUTES_WORDS.againstCountNote);
    expect(minutes.items[1]!.paragraphs).toEqual([]);
    expect(minutes.items[1]!.defects).toEqual([MINUTES_WORDS.defect({ kind: 'notAnnounced', reason: null }).join(' ')]);
  });
});

describe('meetingDefectsInternal — warnings and missing invitations (G-9, G-10)', () => {
  it('G-10: an assembly without any invitation carries notInvited; a backfilled one does not', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting } = await session(deps, ctx, { items: ['simple'], voters: 2 });
    expect(meetingDefectsInternal(deps.db, deps, meeting.id)).toContainEqual({ kind: 'notInvited', agendaItemId: null, reason: null });
  });

  it('G-9: form not allowed, remuneration without statute and an incompatible election stand as defects', async () => {
    const { saveElectionRound } = await import('../src/elections');
    const { holders, officeOf } = await import('./helpers');
    const { deps, ctx } = setupGovernance(RECORDING);
    const [chairHolder] = await holders(deps, ctx, ['chair']);
    const organId = organOf(deps, 'assembly');
    const { meeting, items } = await session(deps, ctx, {
      items: ['remuneration', 'election'],
      voters: 3,
      prepare: async (meetingId) => {
        const { updateMeeting } = await import('../src/meetings');
        unwrap(await updateMeeting(deps, ctx, { id: meetingId, form: 'virtual', remoteNote: 'Videokonferenz' }));
      },
    });
    const r = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'Vergütung', votedAt: '19:10', unanimous: true, details: { statuteReference: null, decidedByOrganId: organId, officeIds: [officeOf(deps, 'treasurer')], mode: 'flat', amountCents: 50000, validFrom: '2026-10-01' } }));
    unwrap(await decideResolution(deps, ctx, { id: r.id, outcome: 'adopted' }));
    unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[1]!.id, officeId: officeOf(deps, 'auditor'), votedAt: '19:20', round: { number: 1, runoff: false, candidates: [], no: 0, abstain: 0, invalid: 0, unanimousContactId: chairHolder! } }));
    const kinds = meetingDefectsInternal(deps.db, deps, meeting.id).map((d) => `${d.kind}:${d.agendaItemId ?? ''}`);
    expect(kinds).toEqual(expect.arrayContaining(['formNotAllowed:', `remunerationWithoutStatute:${items[0]!.id}`, `incompatible:${items[1]!.id}`]));
  });
});
