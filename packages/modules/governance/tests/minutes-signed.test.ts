import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documentLinks, documentRelations, documents, textPdf } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { issueAttendanceList } from '../src/minutes/attachments';
import { attachSignedMinutes, fileSignedMinutes } from '../src/minutes/signed';
import { governanceMeetings } from '../src/schema';
import { endMeeting } from '../src/session';
import { auditOf, officeOf, person, RECORDING, receivedDocument, session, setupGovernance } from './helpers';

const pdf = () => textPdf(['Protokoll, unterschrieben']);

async function recorded(kind: 'ordinary' | 'board' = 'ordinary') {
  const env = setupGovernance(RECORDING);
  const s = await session(env.deps, env.ctx, kind === 'board' ? { kind, items: [] } : { items: [], voters: 2 });
  unwrap(await endMeeting(env.deps, env.ctx, { meetingId: s.meeting.id, endedAt: '21:00' }));
  return { ...env, meetingId: s.meeting.id };
}

describe('fileSignedMinutes', () => {
  it('files the scan as version 1 of type minutes, linked to the meeting, the attendance list as its attachment', async () => {
    const { deps, ctx, meetingId } = await recorded();
    const list = unwrap(await issueAttendanceList(deps, ctx, { meetingId }));
    const filed = unwrap(await fileSignedMinutes(deps, ctx, { meetingId, bytes: pdf() }));
    expect(filed).toMatchObject({ meetingId, version: 1, reason: null });
    const doc = deps.db.select().from(documents).where(eq(documents.id, filed.documentId)).get()!;
    expect(doc.typeKey).toBe('minutes');
    expect(doc.subject).not.toMatch(/Erika/);
    expect(deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, doc.id)).all().map((l) => l.entityType)).toContain('governanceMeeting');
    expect(deps.db.select().from(documentRelations).all().map((r) => [r.documentId, r.relatedDocumentId, r.kind])).toEqual([[list.documentId, doc.id, 'attachmentOf']]);
    expect(auditOf(deps, 'governance.minutes.file').at(-1)!.params).toEqual({ documentNumber: doc.number, version: 1 });
    expect(await fileSignedMinutes(deps, ctx, { meetingId, bytes: pdf() })).toMatchObject({ ok: false, error: { code: 'minutesFiled' } });
  });

  it('a board meeting files governance-board-minutes; another active type is accepted', async () => {
    const { deps, ctx, meetingId } = await recorded('board');
    const filed = unwrap(await fileSignedMinutes(deps, ctx, { meetingId, bytes: pdf() }));
    expect(deps.db.select().from(documents).where(eq(documents.id, filed.documentId)).get()!.typeKey).toBe('governance-board-minutes');
    const other = await recorded('board');
    const withType = unwrap(await fileSignedMinutes(other.deps, other.ctx, { meetingId: other.meetingId, bytes: pdf(), typeKey: 'minutes' }));
    expect(other.deps.db.select().from(documents).where(eq(documents.id, withType.documentId)).get()!.typeKey).toBe('minutes');
  });

  it('refuses a non-PDF, a running meeting and a caller without manage', async () => {
    const { deps, ctx, userId } = setupGovernance(RECORDING);
    const s = await session(deps, ctx, { items: [], voters: 1 });
    expect(await fileSignedMinutes(deps, ctx, { meetingId: s.meeting.id, bytes: pdf() })).toMatchObject({ ok: false, error: { code: 'meetingNotRecorded' } });
    unwrap(await endMeeting(deps, ctx, { meetingId: s.meeting.id, endedAt: '21:00' }));
    expect(await fileSignedMinutes(deps, ctx, { meetingId: s.meeting.id, bytes: new TextEncoder().encode('kein pdf') })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await fileSignedMinutes(deps, ctxWith(['governance.read', 'governance.record'], userId), { meetingId: s.meeting.id, bytes: pdf() })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});

describe('attachSignedMinutes', () => {
  it('links an existing document (old records) as version 1; then minutesFiled', async () => {
    const { deps, ctx, userId, meetingId } = await recorded();
    const existing = await receivedDocument(deps, 'Protokoll alt');
    expect(await attachSignedMinutes(deps, ctx, { meetingId, documentId: existing })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    const withFile = ctxWith([...RECORDING, 'dms.view'], userId);
    const view = unwrap(await attachSignedMinutes(deps, withFile, { meetingId, documentId: existing }));
    expect(view).toMatchObject({ version: 1, documentId: existing });
    expect(deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, existing)).all().map((l) => [l.entityType, l.entityId])).toContainEqual(['governanceMeeting', meetingId]);
    expect(auditOf(deps, 'governance.minutes.attach').at(-1)!.params).toMatchObject({ documentNumber: expect.any(String) });
    expect(await attachSignedMinutes(deps, withFile, { meetingId, documentId: existing })).toMatchObject({ ok: false, error: { code: 'minutesFiled' } });
    expect(deps.db.select().from(governanceMeetings).where(eq(governanceMeetings.id, meetingId)).get()!.sealedAt).toBeNull();
  });
});

describe('G-13: nach Ablage der Fassung', () => {
  /** Eine Versammlung mit Wahl: die eine Gewählte erklärt sich in der Sitzung, die andere (abwesend) noch nicht. */
  async function electedAndFiled() {
    const env = setupGovernance(RECORDING);
    const { saveElectionRound, acceptElection } = await import('../src/elections');
    const s = await session(env.deps, env.ctx, { items: ['election', 'election'], voters: 3 });
    const [present, absent] = [await person(env.deps, 'Anwesend'), await person(env.deps, 'Abwesend')];
    const round = (contactId: string) => ({ number: 1, runoff: false, candidates: [], no: 0, abstain: 0, invalid: 0, unanimousContactId: contactId });
    const p = unwrap(await saveElectionRound(env.deps, env.ctx, { agendaItemId: s.items[0]!.id, officeId: officeOf(env.deps, 'chair'), votedAt: '19:30', round: round(present) }));
    const r = unwrap(await saveElectionRound(env.deps, env.ctx, { agendaItemId: s.items[1]!.id, officeId: officeOf(env.deps, 'treasurer'), votedAt: '19:40', round: round(absent) }));
    unwrap(await acceptElection(env.deps, env.ctx, { resolutionId: p.id, contactId: present }));
    unwrap(await endMeeting(env.deps, env.ctx, { meetingId: s.meeting.id, endedAt: '21:00' }));
    const filed = unwrap(await fileSignedMinutes(env.deps, env.ctx, { meetingId: s.meeting.id, bytes: pdf() }));
    return { ...env, meetingId: s.meeting.id, presentResolutionId: p.id, resolutionId: r.id, present, absent, filed, acceptElection };
  }

  it('(A) election_accept takes only a first declaration; changing a stored one is minutesFiled', async () => {
    const { deps, ctx, presentResolutionId, resolutionId, present, absent, acceptElection } = await electedAndFiled();
    expect(await acceptElection(deps, ctx, { resolutionId: presentResolutionId, contactId: present, declined: true })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'minutesFiled' } });
    unwrap(await acceptElection(deps, ctx, { resolutionId, contactId: absent }));
    expect(await acceptElection(deps, ctx, { resolutionId, contactId: absent, declined: true })).toMatchObject({ ok: false, error: { code: 'minutesFiled' } });
  });

  it('(B) replacing the filed version voids it in the file, with a reason, at the screen only; then the meeting reopens and files anew', async () => {
    const { deps, ctx, meetingId, filed } = await electedAndFiled();
    const { replaceSignedMinutes } = await import('../src/minutes/signed');
    const { reopenMeeting } = await import('../src/session');
    expect(await replaceSignedMinutes(deps, { ...ctx, channel: 'mcp' }, { meetingId, reason: 'Falsche Datei abgelegt' })).toMatchObject({ ok: false, error: { code: 'humanOnly' } });
    expect(await replaceSignedMinutes(deps, ctx, { meetingId, reason: '' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await replaceSignedMinutes(deps, ctxWith(['governance.read', 'governance.record']), { meetingId, reason: 'x' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    unwrap(await replaceSignedMinutes(deps, ctx, { meetingId, reason: 'Falsche Datei abgelegt' }));
    const doc = deps.db.select().from(documents).where(eq(documents.id, filed.documentId)).get()!;
    expect(doc).toMatchObject({ status: 'voided', voidReason: 'Falsche Datei abgelegt' });
    const [entry] = auditOf(deps, 'governance.minutes.replace');
    expect(entry!.params).toEqual({ documentNumber: doc.number, version: 1 });
    expect(JSON.parse(entry!.after!)).toMatchObject({ reason: 'Falsche Datei abgelegt' });
    expect(await replaceSignedMinutes(deps, ctx, { meetingId, reason: 'nochmal' })).toMatchObject({ ok: false, error: { code: 'minutesMissing' } });
    unwrap(await reopenMeeting(deps, ctx, { meetingId }));
    unwrap(await endMeeting(deps, ctx, { meetingId, endedAt: '21:30' }));
    const again = unwrap(await fileSignedMinutes(deps, ctx, { meetingId, bytes: pdf() }));
    expect(again.version).toBe(2);
  });
});
