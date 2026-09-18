import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDraft } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { dmsModule } from '../src/manifest';
import { dmsRecordReferences } from '../src/record-references';
import { documentLinks } from '../src/schema';
import { unlinkDocument } from '../src/service';
import { pdfBytes, setupWithTypes } from './helpers';

describe('dmsRecordReferences', () => {
  it('meldet ein festgeschriebenes Dokument mit Nummer und Link', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = unwrap(await receiveDocument(deps, ctx, { filename: 'v.pdf', bytes: pdfBytes(), typeKey: 'contract', subject: 'Schutzvertrag', documentDate: '2026-03-14', links: [{ entityType: 'animal', entityId: 'A1', role: 'about' }] }));
    expect(dmsRecordReferences(deps, 'animal', 'A1')).toEqual([{ label: `Dokument ${doc.number}`, entity: 'document', id: doc.id, href: `/dms/${doc.id}` }]);
    expect(dmsRecordReferences(deps, 'project', 'A1')).toEqual([]);
  });

  it('meldet auch einen Entwurf — anders als dmsRetentionHolds', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = unwrap(await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Anfrage Tierarzt', body: 'x', links: [{ entityType: 'animal', entityId: 'A2', role: 'about' }] }));
    expect(dmsRecordReferences(deps, 'animal', 'A2')).toEqual([{ label: 'Dokument „Anfrage Tierarzt“ (Entwurf)', entity: 'document', id: draft.id, href: `/dms/${draft.id}` }]);
  });

  it('nennt ein Dokument mit zwei Rollen nur einmal und nichts mehr nach dem Lösen der Bezüge', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = unwrap(await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Doppelt', body: 'x', links: [{ entityType: 'project', entityId: 'P1', role: 'about' }, { entityType: 'project', entityId: 'P1', role: 'sender' }] }));
    const links = deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, draft.id)).all();
    expect(links).toHaveLength(2);
    expect(dmsRecordReferences(deps, 'project', 'P1')).toHaveLength(1);
    for (const link of links) unwrap(await unlinkDocument(deps, ctx, { id: link.id }));
    expect(dmsRecordReferences(deps, 'project', 'P1')).toEqual([]);
  });

  it('hängt am Manifest', () => {
    expect(dmsModule.recordReferences).toBe(dmsRecordReferences);
  });
});
