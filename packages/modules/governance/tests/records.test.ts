import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { saveAgendaItem } from '../src/agenda';
import { createMeeting } from '../src/meetings';
import { saveMotion } from '../src/motions';
import { governanceRecordLabels } from '../src/record-labels';
import { governanceRecordReferences } from '../src/record-references';
import { governanceOrgans } from '../src/schema';
import { receivedDocument, setupGovernance } from './helpers';

describe('meeting labels and references', () => {
  it('labels a meeting with organ, kind and day — forbidden without governance.read', async () => {
    const { deps, ctx, userId } = setupGovernance();
    const mv = deps.db.select().from(governanceOrgans).all().find((o) => o.kind === 'assembly')!;
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: mv.id, kind: 'ordinary', heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' }));
    expect(governanceRecordLabels(deps, ctx, 'governanceMeeting', meeting.id)).toMatchObject({ label: { key: 'governance.records.meeting', params: { organ: mv.name, kind: 'ordinary', date: '2026-09-05' } }, state: 'ok' });
    expect(governanceRecordLabels(deps, ctxWith([], userId), 'governanceMeeting', meeting.id)).toMatchObject({ state: 'forbidden' });
    expect(governanceRecordLabels(deps, ctx, 'governanceMeeting', 'nope')).toMatchObject({ state: 'missing' });
  });

  it('reports a document used as attachment or motion', async () => {
    const { deps, ctx } = setupGovernance();
    const mv = deps.db.select().from(governanceOrgans).all().find((o) => o.kind === 'assembly')!;
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: mv.id, kind: 'ordinary', heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' }));
    const attachment = await receivedDocument(deps, 'Anlage');
    const motionDoc = await receivedDocument(deps, 'Antrag');
    const free = await receivedDocument(deps, 'Frei');
    unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'report', title: 'Bericht', attachmentDocumentIds: [attachment] }));
    unwrap(await saveMotion(deps, ctx, { meetingId: meeting.id, receivedOn: '2026-08-01', text: 'x', documentId: motionDoc }));
    expect(governanceRecordReferences(deps, 'document', attachment)).toEqual([expect.objectContaining({ entity: 'governanceMeeting', id: meeting.id })]);
    expect(governanceRecordReferences(deps, 'document', motionDoc)).toEqual([expect.objectContaining({ entity: 'governanceMeeting', id: meeting.id })]);
    expect(governanceRecordReferences(deps, 'document', free)).toEqual([]);
    expect(governanceRecordReferences(deps, 'project', free)).toEqual([]);
  });
});
