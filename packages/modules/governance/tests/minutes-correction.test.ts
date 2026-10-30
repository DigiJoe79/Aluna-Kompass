import { unwrap } from '@kompass/core';
import { documentRelations, documents, textPdf } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { correctMinutes } from '../src/minutes/correction';
import { fileSignedMinutes, minutesVersionsInternal } from '../src/minutes/signed';
import { governanceTerms } from '../src/schema';
import { sealMeeting } from '../src/seal/seal';
import { endMeeting } from '../src/session';
import { asMcp, auditOf, elect, officeOf, person, RECORDING, session, setupGovernance } from './helpers';

describe('correctMinutes', () => {
  it('Review Focus 5: a new version replaces the old one, which stays; consequences stay; sealing again is meetingSealed', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['election'], voters: 3 });
    await elect(deps, ctx, items[0]!.id, officeOf(deps, 'auditor'), await person(deps, 'Prüferin'));
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    const first = unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Fassung 1']) }));
    expect(await correctMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Fassung 2']), reason: 'Tippfehler im Namen' })).toMatchObject({ ok: false, error: { code: 'meetingNotSealed' } });
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    const terms = deps.db.select().from(governanceTerms).all();

    expect(await correctMinutes(deps, asMcp(ctx), { meetingId: meeting.id, bytes: textPdf(['Fassung 2']), reason: 'Tippfehler im Namen' })).toMatchObject({ ok: false, error: { code: 'humanOnly' } });
    expect(await correctMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Fassung 2']), reason: '' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const second = unwrap(await correctMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Fassung 2']), reason: 'Tippfehler im Namen' }));
    expect(second).toMatchObject({ version: 2, reason: 'Tippfehler im Namen' });
    expect(minutesVersionsInternal(deps.db, meeting.id).map((v) => v.documentId)).toEqual([first.documentId, second.documentId]);
    expect(deps.db.select().from(documentRelations).all().map((r) => [r.documentId, r.relatedDocumentId, r.kind])).toContainEqual([second.documentId, first.documentId, 'replaces']);
    expect(deps.db.select().from(documents).where(eq(documents.id, first.documentId)).get()!.status).not.toBe('voided');
    expect(deps.db.select().from(governanceTerms).all()).toEqual(terms);
    const entry = auditOf(deps, 'governance.minutes.correct').at(-1)!;
    expect(entry.params).toEqual({ documentNumber: second.documentNumber, version: 2 });
    expect(JSON.stringify(entry)).not.toContain('Tippfehler');
    expect(await sealMeeting(deps, ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { code: 'meetingSealed' } });
  });
});
