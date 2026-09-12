import { schema } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createDraft, deleteDraft } from '../src/drafts';
import { createDocumentFollowUp, dmsFollowUpTargets } from '../src/follow-ups';
import { getDocumentRecord, listDocuments } from '../src/service';
import { ALL_DMS, fileFixture, setupWithTypes } from './helpers';

const WITH_FOLLOW_UPS = [...ALL_DMS, 'followUps.view', 'followUps.manage'];

describe('Wiedervorlage am Dokument', () => {
  it('legt sie am Dokument an, das Dokument zeigt sie, die Liste filtert danach', async () => {
    const { deps, userId } = setupWithTypes();
    const ctx = ctxWith(WITH_FOLLOW_UPS, userId);
    const letter = await fileFixture(deps, ctx);
    await fileFixture(deps, ctx);
    const created = await createDocumentFollowUp(deps, ctx, { documentId: letter.id, dueAt: '2026-09-20', title: 'Antwort abwarten' });
    expect(created.ok && created.value.entityType).toBe('document');
    const record = await getDocumentRecord(deps, ctx, letter.id);
    expect(record.ok && record.value.followUps.map((f) => f.title)).toEqual(['Antwort abwarten']);
    const open = await listDocuments(deps, ctx, { withOpenFollowUp: true });
    expect(open.ok && open.value.documents.map((d) => d.id)).toEqual([letter.id]);
  });

  it('prüft das Dokument und das Recht der Akte, bevor der Kern zum Zug kommt', async () => {
    const { deps, userId } = setupWithTypes();
    const ctx = ctxWith(WITH_FOLLOW_UPS, userId);
    const ghost = await createDocumentFollowUp(deps, ctx, { documentId: 'NOPE', dueAt: '2026-09-20', title: 'x' });
    expect(!ghost.ok && ghost.error.type).toBe('notFound');
    const letter = await fileFixture(deps, ctx);
    const noDms = await createDocumentFollowUp(deps, ctxWith(['followUps.manage'], userId), { documentId: letter.id, dueAt: '2026-09-20', title: 'x' });
    expect(!noDms.ok && noDms.error.type === 'forbidden' && noDms.error.permission).toBe('dms.create');
    const noCore = await createDocumentFollowUp(deps, ctxWith(ALL_DMS, userId), { documentId: letter.id, dueAt: '2026-09-20', title: 'x' });
    expect(!noCore.ok && noCore.error.type === 'forbidden' && noCore.error.permission).toBe('followUps.manage');
  });

  it('beschriftet die Entität für die Startseite', async () => {
    const { deps, userId } = setupWithTypes();
    const ctx = ctxWith(WITH_FOLLOW_UPS, userId);
    const letter = await fileFixture(deps, ctx);
    expect(dmsFollowUpTargets(deps, 'document', letter.id)).toEqual({ label: `${letter.number} · Fixture`, href: `/dms/${letter.id}` });
    expect(dmsFollowUpTargets(deps, 'contact', 'C1')).toBeNull();
    expect(dmsFollowUpTargets(deps, 'document', 'NOPE')).toBeNull();
  });

  it('Verwerfen eines Entwurfs räumt seine Wiedervorlagen weg, auch erledigte', async () => {
    const { deps, userId } = setupWithTypes();
    const ctx = ctxWith(WITH_FOLLOW_UPS, userId);
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y' });
    if (!draft.ok) throw new Error('draft');
    const a = await createDocumentFollowUp(deps, ctx, { documentId: draft.value.id, dueAt: '2026-09-20', title: 'a' });
    await createDocumentFollowUp(deps, ctx, { documentId: draft.value.id, dueAt: '2026-09-21', title: 'b' });
    if (!a.ok) throw new Error('follow-up');
    const { completeFollowUp } = await import('@kompass/core');
    await completeFollowUp(deps, ctx, { id: a.value.id });
    await deleteDraft(deps, ctx, { id: draft.value.id });
    expect(deps.db.select().from(schema.followUps).all()).toHaveLength(0);
  });
});
