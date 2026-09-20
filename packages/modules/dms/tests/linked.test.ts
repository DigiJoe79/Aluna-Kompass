import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDraft } from '../src/drafts';
import { linkDocumentInternal, unlinkDocumentInternal } from '../src/linked';
import { documentLinks } from '../src/schema';
import { linkDocument, readLinkedDocument, unlinkDocument } from '../src/service';
import { fileFixture, setupWithProbe } from './helpers';

const code = (r: { ok: boolean; error?: { type: string; code?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

describe('reserved link types', () => {
  it('cannot be set or removed by hand — otherwise anyone with dms.create decided what an auditor sees', async () => {
    const { deps, ctx } = setupWithProbe();
    const doc = await fileFixture(deps, ctx);
    expect(code(await linkDocument(deps, ctx, { documentId: doc.id, entityType: 'probeThing', entityId: 'T1', role: 'about' }))).toBe('linkTypeReserved');
    expect(code(await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: '', links: [{ entityType: 'probeThing', entityId: 'T1', role: 'about' }] }))).toBe('linkTypeReserved');
    const linkId = deps.db.transaction((tx) => linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'probeThing', entityId: 'T1' }));
    expect(code(await unlinkDocument(deps, ctx, { id: linkId }))).toBe('linkTypeReserved');
  });

  it('are set idempotently and removed by their module', async () => {
    const { deps, ctx } = setupWithProbe();
    const doc = await fileFixture(deps, ctx);
    const a = deps.db.transaction((tx) => linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'probeThing', entityId: 'T1' }));
    const b = deps.db.transaction((tx) => linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'probeThing', entityId: 'T1' }));
    expect(a).toBe(b);
    expect(deps.db.transaction((tx) => unlinkDocumentInternal(tx, { documentId: doc.id, entityType: 'probeThing', entityId: 'T1' }))).toBe(1);
    expect(deps.db.select().from(documentLinks).where(eq(documentLinks.entityType, 'probeThing')).all()).toHaveLength(0);
  });
});

describe('readLinkedDocument', () => {
  const link = (deps: Parameters<typeof linkDocumentInternal>[1], documentId: string) => deps.db.transaction((tx) => linkDocumentInternal(tx, deps, { documentId, entityType: 'probeThing', entityId: 'T1' }));

  it('hands out exactly the linked document under the module’s permission — without dms.view', async () => {
    const { deps, ctx } = setupWithProbe();
    const doc = await fileFixture(deps, ctx);
    link(deps, doc.id);
    const res = unwrap(await readLinkedDocument(deps, ctxWith(['probe.read']), { documentId: doc.id, entityType: 'probeThing', entityId: 'T1' }));
    expect(res.record).toMatchObject({ id: doc.id, number: doc.number });
    expect(res.bytes.byteLength).toBeGreaterThan(0);
    expect(res.filename).toBe(`${doc.number}.pdf`);
  });

  it('checks the permission itself', async () => {
    const { deps, ctx } = setupWithProbe();
    const doc = await fileFixture(deps, ctx);
    link(deps, doc.id);
    const res = await readLinkedDocument(deps, ctxWith(['dms.view']), { documentId: doc.id, entityType: 'probeThing', entityId: 'T1' });
    expect(res.ok ? null : res.error).toEqual({ type: 'forbidden', permission: 'probe.read' });
  });

  it('knows nothing without the link, for another record, or for a type nobody registered', async () => {
    const { deps, ctx } = setupWithProbe();
    const doc = await fileFixture(deps, ctx);
    const reader = ctxWith(['probe.read']);
    expect(code(await readLinkedDocument(deps, reader, { documentId: doc.id, entityType: 'probeThing', entityId: 'T1' }))).toBe('notFound');
    link(deps, doc.id);
    expect(code(await readLinkedDocument(deps, reader, { documentId: doc.id, entityType: 'probeThing', entityId: 'T2' }))).toBe('notFound');
    expect(code(await readLinkedDocument(deps, reader, { documentId: doc.id, entityType: 'contact', entityId: 'C1' }))).toBe('notFound');
  });
});

