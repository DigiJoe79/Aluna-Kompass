import { conflict, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDraft } from '../src/drafts';
import { abortReceive, linkDocumentInternal, receiveGeneratedUpload, unlinkDocumentInternal } from '../src/linked';
import { documentLinks, documents } from '../src/schema';
import { linkDocument, readLinkedDocument, unlinkDocument } from '../src/service';
import { fileFixture, pdfBytes, setupWithProbe } from './helpers';

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

describe('receiveGeneratedUpload', () => {
  const upload = { bytes: pdfBytes(), typeKey: 'invoice', subject: 'Beleg zu Vorgang T1', documentDate: '2026-09-01', links: [{ entityType: 'probeThing', entityId: 'T1' as const }] };

  it('files in the name of the record — with the module’s permission and without dms.create', async () => {
    const { deps } = setupWithProbe();
    const { document } = unwrap(await receiveGeneratedUpload(deps, ctxWith(['probe.issue'], 'U-HELPER'), upload));
    expect(deps.db.select().from(documents).where(eq(documents.id, document.id)).get()).toMatchObject({ phase: 'issued', direction: 'incoming', sourceKind: 'uploaded', number: document.number, documentDate: '2026-09-01', textStatus: 'pending', createdByUserId: 'U-HELPER' });
    expect(code(await readLinkedDocument(deps, ctxWith(['probe.read']), { documentId: document.id, entityType: 'probeThing', entityId: 'T1' }))).toBe('ok');
  });

  it('checks the receive permission itself and wants a registered record', async () => {
    const { deps } = setupWithProbe();
    const denied = await receiveGeneratedUpload(deps, ctxWith(['dms.create']), upload);
    expect(denied.ok ? null : denied.error).toEqual({ type: 'forbidden', permission: 'probe.issue' });
    expect(code(await receiveGeneratedUpload(deps, ctxWith(['probe.issue']), { ...upload, links: [{ entityType: 'contact', entityId: 'C1' }] }))).toBe('noLinkedRecord');
  });

  it('runs afterReceive in the transaction; abortReceive leaves neither row nor file nor number', async () => {
    const { deps } = setupWithProbe();
    const res = await receiveGeneratedUpload(deps, ctxWith(['probe.issue']), { ...upload, afterReceive: () => abortReceive(conflict('claimClosed', 'Antrag ist abgeschlossen')) });
    expect(code(res)).toBe('claimClosed');
    expect(deps.db.select().from(documents).all()).toHaveLength(0);
  });

  it('takes no photo', async () => {
    const { deps } = setupWithProbe();
    const res = await receiveGeneratedUpload(deps, ctxWith(['probe.issue']), { ...upload, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) });
    expect(res.ok ? null : res.error).toMatchObject({ type: 'validation', issues: [{ path: 'file', message: 'notAPdf' }] });
  });
});


