import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documentLinks, documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { recordArrival, saveAttendance } from '../src/attendance';
import { acceptElection, saveElectionRound } from '../src/elections';
import { issueAttendanceList, issueRegisterData } from '../src/minutes/attachments';
import { ATTACHMENT_WORDS } from '../src/minutes/attachment-templates';
import { peakInternal } from '../src/minutes/attachments';
import { endMeeting } from '../src/session';
import { addressedPerson, auditOf, member, minorMember, officeOf, person, RECORDING, session, setupGovernance } from './helpers';

const inputOf = (deps: ReturnType<typeof setupGovernance>['deps'], documentId: string) => JSON.parse(deps.db.select().from(documents).where(eq(documents.id, documentId)).get()!.inputSnapshot!).input;
const unanimous = (contactId: string) => ({ number: 1, runoff: false, candidates: [], no: 0, abstain: 0, invalid: 0, unanimousContactId: contactId });

describe('issueAttendanceList', () => {
  it('lists name, role, vote and times — guests by their label, nobody with an address', async () => {
    const { deps, ctx, userId } = setupGovernance(RECORDING);
    await member(deps, { contactId: await addressedPerson(deps, { lastName: 'Anschrift' }) });
    const { meeting } = await session(deps, ctx, { items: [], voters: 1 });
    const guest = unwrap(await saveAttendance(deps, ctx, { meetingId: meeting.id, role: 'guest', guestLabel: 'Presse' }));
    unwrap(await recordArrival(deps, ctx, { attendanceId: guest.id, at: '19:30' }));
    expect(await issueAttendanceList(deps, ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { code: 'meetingNotRecorded' } });
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    expect(await issueAttendanceList(deps, ctxWith(['governance.read', 'governance.record'], userId), { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });

    const issued = unwrap(await issueAttendanceList(deps, ctx, { meetingId: meeting.id }));
    const doc = deps.db.select().from(documents).where(eq(documents.id, issued.documentId)).get()!;
    expect(doc).toMatchObject({ typeKey: 'governance-attendance', number: issued.number });
    expect(deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, doc.id)).all().map((l) => [l.entityType, l.entityId, l.role])).toEqual([['governanceMeeting', meeting.id, 'about']]);
    const input = inputOf(deps, doc.id);
    expect(input.rows).toHaveLength(3);
    // Mitglieder vor Gästen, Namen „Nachname, Vorname“, Nummern fortlaufend.
    expect(input.rows.at(-1)).toEqual({ no: 3, name: 'Presse', voting: ATTACHMENT_WORDS.guest, arrivals: '19:30', departures: '' });
    expect(input.rows.map((r: { name: string }) => r.name)).toContain('Anschrift, Erika');
    expect(input.summary).toContain('19:00');
    for (const secret of ['Lindenweg', '12345', 'Beispielstadt']) expect(JSON.stringify(input)).not.toContain(secret);
    expect(auditOf(deps, 'governance.minutes.attendanceList').at(-1)!.params).toEqual({ documentNumber: issued.number });
  });
});

describe('issueRegisterData', () => {
  it('lists the accepted elected of representative offices with birth date (or a blank) and town, without the auditor', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['election', 'election', 'election'], voters: 3 });
    const chair = (await minorMember(deps, await addressedPerson(deps, { lastName: 'Vormund' }), '2015-04-01')).contactId;
    const deputy = await person(deps, 'Ohnemitglied', 'Max');
    const auditor = await person(deps, 'Prüfer', 'Paula');
    for (const [i, fn, contactId] of [[0, 'chair', chair], [1, 'board', deputy], [2, 'auditor', auditor]] as const) {
      const r = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[i]!.id, officeId: officeOf(deps, fn), votedAt: `19:${i}5`, round: unanimous(contactId) }));
      unwrap(await acceptElection(deps, ctx, { resolutionId: r.id, contactId }));
    }
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    const issued = unwrap(await issueRegisterData(deps, ctx, { meetingId: meeting.id }));
    const doc = deps.db.select().from(documents).where(eq(documents.id, issued.documentId)).get()!;
    expect(doc.typeKey).toBe('governance-register-data');
    expect(inputOf(deps, doc.id).rows).toEqual([
      { name: 'Kind, Erika', office: 'Vorsitz', status: 'new', birthDate: '01.04.2015', city: 'Beispielstadt' },
      { name: 'Ohnemitglied, Max', office: 'Stellvertretender Vorsitz', status: 'new', birthDate: ATTACHMENT_WORDS.blank, city: ATTACHMENT_WORDS.blank },
    ]);
    const audit = auditOf(deps, 'governance.minutes.registerData').at(-1)!;
    expect(audit.params).toEqual({ documentNumber: issued.number, count: 2 });
    expect(JSON.stringify(audit)).not.toContain('2015');
  });
});

describe('peakInternal (U2)', () => {
  it('counts the most voting people at the same time; leaving and coming in the same minute does not count twice', () => {
    expect(peakInternal([[{ from: '19:00', to: '19:05' }], [{ from: '19:10', to: null }]])).toEqual({ count: 1, at: '19:00' });
    expect(peakInternal([[{ from: '19:00', to: null }], [{ from: '19:10', to: null }]])).toEqual({ count: 2, at: '19:10' });
    expect(peakInternal([[{ from: '19:00', to: '19:10' }], [{ from: '19:10', to: null }]])).toEqual({ count: 1, at: '19:00' });
    expect(peakInternal([])).toEqual({ count: 0, at: null });
  });
});

describe('register data sheet (U2)', () => {
  it('after electing the treasurer a new row and the predecessor as left; representation two names two signers', async () => {
    const { withRules, holders, elect } = await import('./helpers');
    const { registerDataInputInternal } = await import('../src/minutes/attachments');
    const { meetingRowInternal } = await import('../src/meetings');
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { board: { representation: { mode: 'two' } } });
    const [chair, , oldTreasurer] = await holders(deps, ctx, ['chair', 'board', 'treasurer'], '2024-09-05');
    const { meeting, items } = await session(deps, ctx, { items: ['election'], voters: 3 });
    const successor = await person(deps, 'Neu', 'Nora');
    await elect(deps, ctx, items[0]!.id, officeOf(deps, 'treasurer'), successor);
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    const data = registerDataInputInternal(deps.db, meetingRowInternal(deps.db, meeting.id)!);
    expect(data.rows.map((r) => [r.name, r.status])).toEqual([
      ['Neu, Nora', 'new'],
      ['Amt treasurer 2, Erika', 'left'],
    ]);
    expect(data.representation).toContain('Erika Amt chair 0');
    expect(data.representation).toContain('Erika Amt board 1');
    expect(data.representation).not.toContain('Nora Neu');
    expect(data.changes).toContain('Kasse');
    void chair;
    void oldTreasurer;
  });
});

describe('attendance in the minutes head and on the list (G-12)', () => {
  it('a present supporting member is neither a voter nor a guest — head and list say the same', async () => {
    const { member: addMember, RECORDING: rec, session: run, setupGovernance: setup } = await import('./helpers');
    const { composeMinutesInternal } = await import('../src/minutes/compose');
    const { MINUTES_WORDS } = await import('../src/minutes/words');
    const { ATTACHMENT_WORDS } = await import('../src/minutes/attachment-templates');
    const { attendanceListInputInternal } = await import('../src/minutes/attachments');
    const { deps, ctx } = setup(rec);
    await addMember(deps, { type: 'supporting' });
    const { meeting } = await run(deps, ctx, { items: ['simple'], voters: 2 });
    const head = composeMinutesInternal(deps.db, deps, meeting.id).head.find((h) => h.label === MINUTES_WORDS.headAttendance)!.value;
    expect(head).toBe(MINUTES_WORDS.attendanceHead(2, 2, 1, 0, 'assembly'));
    expect(attendanceListInputInternal(deps.db, meeting).summary).toBe(ATTACHMENT_WORDS.summary(2, 1, 0, 2, '19:00'));
  });
});

describe('issueRegisterData without elected persons (G-26)', () => {
  it('refuses with registerDataEmpty when nobody was elected into a representative office', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting } = await session(deps, ctx, { items: ['simple'], voters: 2 });
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    expect(await issueRegisterData(deps, ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'registerDataEmpty' } });
  });
});

describe('W-9: attachments of the minutes', () => {
  it('warns before sealing that the attendance list named as attachment is not issued; issued, the warning is gone', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting } = await session(deps, ctx, { items: [], voters: 1 });
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    const { previewSeal } = await import('../src/seal/preview');
    const { getMinutesText } = await import('../src/minutes/print');
    expect(unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id })).warnings).toEqual(['attendanceListMissing']);
    expect(unwrap(await getMinutesText(deps, ctx, { meetingId: meeting.id })).attachmentsMissing).toEqual(['attendanceList']);
    unwrap(await issueAttendanceList(deps, ctx, { meetingId: meeting.id }));
    expect(unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id })).warnings).toEqual([]);
    expect(unwrap(await getMinutesText(deps, ctx, { meetingId: meeting.id })).attachmentsMissing).toEqual([]);
  });

  it('a corrected version carries the attachments too', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting } = await session(deps, ctx, { items: [], voters: 1 });
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    const list = unwrap(await issueAttendanceList(deps, ctx, { meetingId: meeting.id }));
    const { fileSignedMinutes } = await import('../src/minutes/signed');
    const { correctMinutes } = await import('../src/minutes/correction');
    const { sealMeeting } = await import('../src/seal/seal');
    const { textPdf, documentRelations } = await import('@kompass/module-dms');
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    const corrected = unwrap(await correctMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Berichtigt']), reason: 'Tippfehler' }));
    const attached = deps.db.select().from(documentRelations).all().filter((r) => r.kind === 'attachmentOf' && r.relatedDocumentId === corrected.documentId).map((r) => r.documentId);
    expect(attached).toContain(list.documentId);
  });
});
