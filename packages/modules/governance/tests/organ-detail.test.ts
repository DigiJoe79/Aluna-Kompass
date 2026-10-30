import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documents, textPdf } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fileSignedMinutes } from '../src/minutes/signed';
import { getOrganDetail } from '../src/organ-detail';
import { sealMeeting } from '../src/seal/seal';
import { endMeeting } from '../src/session';
import { endTerm, startTerm } from '../src/terms';
import { elect, officeOf, organOf, person, receivedDocument, RECORDING, session, setupGovernance } from './helpers';

describe('getOrganDetail', () => {
  it('an elected term names resolution number and agenda position; a backfilled one its document number; earlier ones after running ones', async () => {
    const { deps, ctx } = setupGovernance([...RECORDING, 'dms.view']);
    const chair = officeOf(deps, 'chair');
    const proof = await receivedDocument(deps, 'Niederschrift 2024');
    const old = unwrap(await startTerm(deps, ctx, { officeId: chair, contactId: await person(deps, 'Früher'), since: '2024-09-05', origin: 'backfilled', documentId: proof }));
    unwrap(await endTerm(deps, ctx, { id: old.id, until: '2025-01-31', reason: 'other' }));
    const { meeting, items } = await session(deps, ctx, { items: ['simple', 'election'], voters: 2 });
    const elected = await person(deps, 'Gewählt');
    await elect(deps, ctx, items[1]!.id, chair, elected);
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));

    const detail = unwrap(await getOrganDetail(deps, ctx, { organId: organOf(deps, 'board') }));
    expect(detail.organ.kind).toBe('board');
    expect(detail.terms.map((t) => [t.name, t.running])).toEqual([
      ['Erika Gewählt', true],
      ['Erika Früher', false],
    ]);
    expect(detail.terms[0]!.origin).toMatchObject({ kind: 'elected', meetingId: meeting.id, meetingKind: 'ordinary', heldOn: '2026-09-05', itemPosition: 2, resolutionNumber: 'B-2026-001' });
    const number = deps.db.select().from(documents).where(eq(documents.id, proof)).get()!.number;
    expect(detail.terms[1]!.origin).toMatchObject({ kind: 'backfilled', documentId: proof, documentNumber: number, resolutionNumber: null });
    expect(detail.terms[1]!.officeName).toBe('Vorsitz');
    expect(detail.representation).toMatchObject({ source: 'law' });
  });

  it('notFound, validation and forbidden', async () => {
    const { deps, ctx, userId } = setupGovernance();
    expect(await getOrganDetail(deps, ctx, { organId: 'fehlt' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await getOrganDetail(deps, ctx, {})).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await getOrganDetail(deps, ctxWith([], userId), { organId: organOf(deps, 'board') })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(unwrap(await getOrganDetail(deps, ctx, { organId: organOf(deps, 'assembly') })).representation).toBeNull();
  });
});
