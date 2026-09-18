import type { CallContext, Deps } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { createDraft, deleteDraft } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { relateDocuments, relationsFor, unrelateDocuments } from '../src/relations';
import { getDocumentRecord } from '../src/service';
import { auditActions, fileFixture, pdfBytes, setupWithTypes } from './helpers';

async function incoming(deps: Deps, ctx: CallContext, subject: string) {
  const res = await receiveDocument(deps, ctx, { filename: `${subject}.pdf`, bytes: pdfBytes(), typeKey: 'authority', subject, documentDate: '2026-09-01' });
  if (!res.ok) throw new Error('receive');
  return res.value;
}

describe('Dokumentbezüge', () => {
  it('ein Eingang antwortet auf einen Brief, und beide Seiten wissen es', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const answer = await incoming(deps, ctx, 'Bescheid');
    const related = await relateDocuments(deps, ctx, { documentId: answer.id, relatedDocumentId: letter.id, kind: 'repliesTo' });
    expect(related.ok).toBe(true);
    expect(auditActions(deps)).toContain('dms.relate');

    expect(relationsFor(deps.db, answer.id)).toEqual([
      expect.objectContaining({ kind: 'repliesTo', direction: 'out', otherId: letter.id, otherNumber: letter.number, otherSubject: 'Fixture', otherPhase: 'issued' }),
    ]);
    expect(relationsFor(deps.db, letter.id)).toEqual([
      expect.objectContaining({ kind: 'repliesTo', direction: 'in', otherId: answer.id, otherSubject: 'Bescheid' }),
    ]);
    const record = await getDocumentRecord(deps, ctx, letter.id);
    expect(record.ok && record.value.relations).toHaveLength(1);
  });

  it('kein Bezug auf sich selbst, kein Doppel, kein unbekanntes Ende', async () => {
    const { deps, ctx } = setupWithTypes();
    const a = await fileFixture(deps, ctx);
    const b = await incoming(deps, ctx, 'b');
    const self = await relateDocuments(deps, ctx, { documentId: a.id, relatedDocumentId: a.id, kind: 'attachmentOf' });
    expect(!self.ok && self.error.type === 'conflict' && self.error.code).toBe('relationSelf');
    await relateDocuments(deps, ctx, { documentId: a.id, relatedDocumentId: b.id, kind: 'attachmentOf' });
    const twice = await relateDocuments(deps, ctx, { documentId: a.id, relatedDocumentId: b.id, kind: 'attachmentOf' });
    expect(!twice.ok && twice.error.type === 'conflict' && twice.error.code).toBe('relationExists');
    const ghost = await relateDocuments(deps, ctx, { documentId: a.id, relatedDocumentId: 'NOPE', kind: 'attachmentOf' });
    expect(!ghost.ok && ghost.error.type).toBe('notFound');
  });

  it('ein Entwurf darf Ende eines Bezugs sein, und Verwerfen nimmt den Bezug mit', async () => {
    const { deps, ctx } = setupWithTypes();
    const inbound = await incoming(deps, ctx, 'Anfrage');
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Antwort', body: 'x' });
    if (!draft.ok) throw new Error('draft');
    const rel = await relateDocuments(deps, ctx, { documentId: draft.value.id, relatedDocumentId: inbound.id, kind: 'repliesTo' });
    expect(rel.ok).toBe(true);
    expect(relationsFor(deps.db, inbound.id)).toHaveLength(1);
    await deleteDraft(deps, ctx, { id: draft.value.id });
    expect(relationsFor(deps.db, inbound.id)).toHaveLength(0);
  });

  it('löst einen Bezug wieder, mit Protokoll, und braucht das Recht', async () => {
    const { deps, ctx } = setupWithTypes();
    const a = await fileFixture(deps, ctx);
    const b = await incoming(deps, ctx, 'b');
    const rel = await relateDocuments(deps, ctx, { documentId: a.id, relatedDocumentId: b.id, kind: 'signedCopyOf' });
    if (!rel.ok) throw new Error('relate');
    const { ctx: reader } = setupWithTypes(['dms.view']);
    const denied = await unrelateDocuments(deps, reader, { id: rel.value.id });
    expect(!denied.ok && denied.error.type).toBe('forbidden');
    const gone = await unrelateDocuments(deps, ctx, { id: rel.value.id });
    expect(gone.ok).toBe(true);
    expect(auditActions(deps)).toContain('dms.unrelate');
    const bad = await relateDocuments(deps, ctx, { documentId: a.id, relatedDocumentId: b.id, kind: 'somethingElse' });
    expect(!bad.ok && bad.error.type).toBe('validation');
  });

  it('Post kann beim Ablegen schon sagen, worauf sie antwortet', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const res = await receiveDocument(deps, ctx, {
      filename: 'antwort.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'Antwort', documentDate: '2026-09-02',
      relations: [{ relatedDocumentId: letter.id, kind: 'repliesTo' }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.relations).toEqual([expect.objectContaining({ kind: 'repliesTo', direction: 'out', otherId: letter.id })]);
    const ghost = await receiveDocument(deps, ctx, {
      filename: 'x.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'x', documentDate: '2026-09-02',
      relations: [{ relatedDocumentId: 'NOPE', kind: 'repliesTo' }],
    });
    expect(!ghost.ok && ghost.error.type).toBe('notFound');
  });
});
