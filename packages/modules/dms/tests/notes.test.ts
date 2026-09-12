import { ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createDraft, deleteDraft } from '../src/drafts';
import { addNote, deleteNote, notesFor } from '../src/notes';
import { getDocumentRecord } from '../src/service';
import { ALL_DMS, auditActions, fileFixture, setupWithTypes } from './helpers';

describe('Notizen', () => {
  it('hängt Notizen an, chronologisch, mit Person und Zeit, auch an Entwürfe', async () => {
    const { deps, ctx, userId } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y' });
    if (!draft.ok) throw new Error('draft');
    const a = await addNote(deps, ctx, { documentId: draft.value.id, body: 'erst' });
    const b = await addNote(deps, ctx, { documentId: draft.value.id, body: 'dann' });
    expect(a.ok && b.ok).toBe(true);
    expect(notesFor(deps.db, draft.value.id).map((n) => [n.body, n.createdByUserId])).toEqual([['erst', userId], ['dann', userId]]);
    const record = await getDocumentRecord(deps, ctx, draft.value.id);
    expect(record.ok && record.value.notes).toHaveLength(2);
    expect(auditActions(deps)).toContain('dms.note.add');
  });

  it('weist leere und überlange Notizen und unbekannte Dokumente ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    expect((await addNote(deps, ctx, { documentId: letter.id, body: '   ' })).ok).toBe(false);
    expect((await addNote(deps, ctx, { documentId: letter.id, body: 'x'.repeat(4001) })).ok).toBe(false);
    const ghost = await addNote(deps, ctx, { documentId: 'NOPE', body: 'x' });
    expect(!ghost.ok && ghost.error.type).toBe('notFound');
  });

  it('die eigene Notiz löscht, wer sie schrieb; eine fremde nur, wer verwaltet', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const mine = await addNote(deps, ctx, { documentId: letter.id, body: 'meine' });
    if (!mine.ok) throw new Error('note');
    const otherId = insertUser(deps, { name: 'Mira', email: 'mira@example.org' });
    const other = ctxWith(['dms.view', 'dms.create'], otherId);
    const denied = await deleteNote(deps, other, { id: mine.value.id });
    expect(!denied.ok && denied.error.type === 'forbidden' && denied.error.permission).toBe('dms.manage');
    const manager = ctxWith(ALL_DMS, otherId);
    expect((await deleteNote(deps, manager, { id: mine.value.id })).ok).toBe(true);
    expect(auditActions(deps)).toContain('dms.note.delete');
  });

  it('Verwerfen eines Entwurfs nimmt die Notizen mit', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y' });
    if (!draft.ok) throw new Error('draft');
    await addNote(deps, ctx, { documentId: draft.value.id, body: 'weg damit' });
    await deleteDraft(deps, ctx, { id: draft.value.id });
    expect(notesFor(deps.db, draft.value.id)).toHaveLength(0);
  });
});
