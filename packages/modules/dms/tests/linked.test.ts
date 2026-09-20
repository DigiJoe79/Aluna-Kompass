import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDraft } from '../src/drafts';
import { linkDocumentInternal, unlinkDocumentInternal } from '../src/linked';
import { documentLinks } from '../src/schema';
import { linkDocument, unlinkDocument } from '../src/service';
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
