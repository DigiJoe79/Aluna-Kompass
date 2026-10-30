import { unwrap } from '@kompass/core';
import { ctxWith, insertUser } from '@kompass/core/testing';
import { textPdf } from '@kompass/module-dms';
import { describe, expect, it } from 'vitest';
import { saveAgendaItem } from '../src/agenda';
import { setAgendaNote } from '../src/agenda-note';
import { backfillMeeting } from '../src/backfill';
import { composeMinutesInternal } from '../src/minutes/compose';
import { fileSignedMinutes } from '../src/minutes/signed';
import { saveResolution, decideResolution } from '../src/resolutions';
import { sealMeeting } from '../src/seal/seal';
import { endMeeting } from '../src/session';
import { auditOf, organOf, RECORDING, session, setupGovernance } from './helpers';

const NOTE = 'Die Kassiererin erläuterte den Bericht; Rückfragen gab es zur Futterspende.';

describe('setAgendaNote', () => {
  it('saves the note of an item in the running meeting and after its end; the audit has only the position', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['report', 'simple'], voters: 3 });
    const saved = unwrap(await setAgendaNote(deps, ctx, { itemId: items[0]!.id, note: NOTE }));
    expect(saved).toMatchObject({ id: items[0]!.id, minutesNote: NOTE });
    const entry = auditOf(deps, 'governance.agenda.note').at(-1)!;
    expect(entry.params).toEqual({ position: 1 });
    expect(JSON.stringify(entry)).not.toContain('Futterspende');

    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    expect(unwrap(await setAgendaNote(deps, ctx, { itemId: items[1]!.id, note: 'Kurz besprochen.' })).minutesNote).toBe('Kurz besprochen.');
    // Leer entfernt die Notiz.
    expect(unwrap(await setAgendaNote(deps, ctx, { itemId: items[1]!.id, note: '  ' })).minutesNote).toBeNull();
  });

  it('refuses without governance.record, for another writer, with an overlong note, and after sealing', async () => {
    const { deps, ctx, userId } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['report'], voters: 3 });
    expect(await setAgendaNote(deps, ctxWith(['governance.read', 'governance.manage'], userId), { itemId: items[0]!.id, note: NOTE })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    const other = insertUser(deps, { name: 'Andere', email: 'andere@kompass.local' });
    expect(await setAgendaNote(deps, ctxWith(RECORDING, other), { itemId: items[0]!.id, note: NOTE })).toMatchObject({ ok: false, error: { code: 'notWriter' } });
    expect(await setAgendaNote(deps, ctx, { itemId: items[0]!.id, note: 'x'.repeat(5001) })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await setAgendaNote(deps, ctx, { itemId: 'fehlt', note: NOTE })).toMatchObject({ ok: false, error: { type: 'notFound' } });

    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    expect(await setAgendaNote(deps, ctx, { itemId: items[0]!.id, note: NOTE })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'meetingSealed' } });
  });

  it('refuses once the signed minutes are filed — the record follows the signed paper, then only a correction', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['report'], voters: 3 });
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    expect(unwrap(await setAgendaNote(deps, ctx, { itemId: items[0]!.id, note: NOTE })).minutesNote).toBe(NOTE);
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
    expect(await setAgendaNote(deps, ctx, { itemId: items[0]!.id, note: 'Anders.' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'minutesFiled' } });
  });

  it('a backfilled meeting takes the note with governance.manage', async () => {
    const { deps, ctx, userId } = setupGovernance(RECORDING);
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), kind: 'ordinary', heldOn: '2026-03-01', startsAt: '18:00', endedAt: '20:00', form: 'inPerson', present: 5, voting: 5 }));
    const item = unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'report', title: 'Bericht' }));
    expect(await setAgendaNote(deps, ctxWith(['governance.read', 'governance.record'], userId), { itemId: item.id, note: NOTE })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(unwrap(await setAgendaNote(deps, ctx, { itemId: item.id, note: NOTE })).minutesNote).toBe(NOTE);
  });
});

describe('composeMinutesInternal — notes', () => {
  it('puts the note before the result; an item without resolution is title and note', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['report', 'simple'], voters: 3 });
    unwrap(await setAgendaNote(deps, ctx, { itemId: items[0]!.id, note: NOTE }));
    unwrap(await setAgendaNote(deps, ctx, { itemId: items[1]!.id, note: 'Nach kurzer Aussprache wurde abgestimmt.' }));
    const r = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[1]!.id, text: 'Wir kaufen einen Anhänger.', votedAt: '19:10', unanimous: true }));
    unwrap(await decideResolution(deps, ctx, { id: r.id, outcome: 'adopted' }));
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    const minutes = composeMinutesInternal(deps.db, deps, meeting.id);
    expect(minutes.items[0]!.paragraphs).toEqual([NOTE]);
    expect(minutes.items[1]!.paragraphs).toHaveLength(2);
    expect(minutes.items[1]!.paragraphs[0]).toBe('Nach kurzer Aussprache wurde abgestimmt.');
    expect(minutes.items[1]!.paragraphs[1]).toContain('Wir kaufen einen Anhänger.');
  });
});
