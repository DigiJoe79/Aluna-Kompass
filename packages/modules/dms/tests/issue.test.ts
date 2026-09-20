import { conflict, unwrap } from '@kompass/core';
import { auditEntry } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { abortIssue, issueGeneratedDocument } from '../src/issue';
import { documentCounters, documentLinks, documents } from '../src/schema';
import { listDocuments, voidDocument } from '../src/service';
import { readDocumentFile } from '../src/storage';
import { setupWithProbe } from './helpers';

const NOTE = { templateKey: 'probe-note', input: { text: 'Hallo' }, subject: 'Notiz 1', documentDate: '2026-03-15' };
const code = (r: { ok: boolean; error?: { type: string; code?: string; permission?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

describe('issueGeneratedDocument', () => {
  it('files a document of a module-owned type — no draft, number and date in the body, waiting for the text worker', async () => {
    const { deps, ctx, userId } = setupWithProbe();
    const { document } = unwrap(await issueGeneratedDocument(deps, ctx, { ...NOTE, links: [{ entityType: 'probeThing', entityId: 'T1' }] }));
    const row = deps.db.select().from(documents).where(eq(documents.id, document.id)).get()!;
    expect(row).toMatchObject({ phase: 'issued', status: 'issued', sourceKind: 'generated', direction: 'outgoing', typeKey: 'probe-note', number: 'NTZ-2026-001', templateKey: 'probe-note', textStatus: 'pending', draftBody: null, createdByUserId: userId, documentDate: '2026-03-15' });
    const pdf = new TextDecoder().decode(await readDocumentFile(deps, row.fileName!));
    expect(pdf).toContain('NUMMER NTZ-2026-001 DATUM 2026-03-15 Hallo');
    expect(deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, row.id)).all()).toMatchObject([{ entityType: 'probeThing', entityId: 'T1', role: 'about' }]);
    expect(JSON.parse(auditEntry(deps, 'dms.issue').after as string)).toEqual({ number: 'NTZ-2026-001', templateKey: 'probe-note', typeKey: 'probe-note' });
  });

  it('asks for the permission of the template, not for dms.file', async () => {
    const { deps } = setupWithProbe();
    const { ctx: reader } = { ctx: (await import('@kompass/core/testing')).ctxWith(['dms.file', 'dms.create']) };
    const res = await issueGeneratedDocument(deps, reader, NOTE);
    expect(res.ok ? null : res.error).toEqual({ type: 'forbidden', permission: 'probe.issue' });
  });

  it('stores the snapshot instead of the input when given one', async () => {
    const { deps, ctx } = setupWithProbe();
    const { document } = unwrap(await issueGeneratedDocument(deps, ctx, { ...NOTE, snapshot: { hash: 'abc' } }));
    const stored = JSON.parse(deps.db.select().from(documents).where(eq(documents.id, document.id)).get()!.inputSnapshot!);
    expect(stored).toMatchObject({ input: { hash: 'abc' }, base: 'a4-plain' });
    expect(JSON.stringify(stored)).not.toContain('Hallo');
  });

  it('runs afterIssue inside the transaction and hands back what it returns', async () => {
    const { deps, ctx } = setupWithProbe();
    const res = unwrap(await issueGeneratedDocument(deps, ctx, { ...NOTE, afterIssue: (tx, doc) => `${doc.number}:${tx.select().from(documents).where(eq(documents.id, doc.id)).get()!.phase}` }));
    expect(res.after).toBe('NTZ-2026-001:issued');
  });

  it('abortIssue rolls back the row and the number and removes the file', async () => {
    const { deps, ctx } = setupWithProbe();
    let fileName = '';
    const res = await issueGeneratedDocument(deps, ctx, { ...NOTE, afterIssue: (tx, doc) => { fileName = `${doc.id.toLowerCase()}.pdf`; return abortIssue(conflict('lineAlreadyConfirmed', 'schon bestätigt')); } });
    expect(code(res)).toBe('lineAlreadyConfirmed');
    expect(deps.db.select().from(documents).all()).toHaveLength(0);
    expect(deps.db.select().from(documentCounters).all()).toHaveLength(0);
    await expect(readDocumentFile(deps, fileName)).rejects.toThrow();
  });

  it('refuses a template whose type belongs to no module, and one without a permission', async () => {
    const { deps, ctx } = setupWithProbe();
    expect(code(await issueGeneratedDocument(deps, { ...ctx, permissions: new Set([...ctx.permissions, 'dms.file']) }, { ...NOTE, templateKey: 'letter', input: { subject: 'x', body: '', recipient: null } }))).toBe('documentTypeNotOwned');
  });

  it('keeps its documents out of „unsent“, and only its module may void them', async () => {
    const { deps, ctx } = setupWithProbe();
    const { document } = unwrap(await issueGeneratedDocument(deps, ctx, NOTE));
    expect(unwrap(await listDocuments(deps, ctx, { unsent: true })).total).toBe(0);
    expect(code(await voidDocument(deps, ctx, { id: document.id, reason: 'Test' }))).toBe('documentTypeOwnedByModule');
  });
});
