import { unwrap, type Deps } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { replaceDocumentText } from '../src/index-store';
import { relateDocuments } from '../src/relations';
import { getDocument, getDocumentRecord, listDocuments } from '../src/service';
import { countUnreadDocuments, getDocumentText } from '../src/text';
import { setupWithArea } from './helpers';

const denied = (r: { ok: boolean; error?: unknown }) => (r.ok ? null : r.error);

/** Text in den Volltextindex schreiben, wie der Worker es nach dem Lesen tut. */
function indexText(deps: Deps, documentId: string, text: string) {
  replaceDocumentText(deps, documentId, [{ page: 1, text }]);
}

describe('a protected document type — reading', () => {
  it('list: dms.view does not show it, the area permission shows exactly it', async () => {
    const { deps, viewer, auditor, secretId, openId } = await setupWithArea();
    const forViewer = unwrap(await listDocuments(deps, viewer, {}));
    expect(forViewer.documents.map((d) => d.id)).toEqual([openId]);
    expect(forViewer.total).toBe(1);
    const forAuditor = unwrap(await listDocuments(deps, auditor, {}));
    expect(forAuditor.documents.map((d) => d.id)).toEqual([secretId]);
    expect(forAuditor.total).toBe(1);
  });

  it('list: neither the subject search nor the type filter finds it', async () => {
    const { deps, viewer } = await setupWithArea();
    expect(unwrap(await listDocuments(deps, viewer, { text: 'geheimer' })).total).toBe(0);
    expect(unwrap(await listDocuments(deps, viewer, { typeKey: 'secret' })).total).toBe(0);
  });

  it('list: the full text does not find it either — the filter is its own AND condition', async () => {
    const { deps, viewer, secretId } = await setupWithArea();
    indexText(deps, secretId, 'Zahnradbahn');
    const res = unwrap(await listDocuments(deps, viewer, { text: 'Zahnradbahn' }));
    expect([res.total, Object.keys(res.hits)]).toEqual([0, []]);
  });

  it('record, file and text answer forbidden with the permission of the area', async () => {
    const { deps, viewer, auditor, secretId } = await setupWithArea();
    const missing = { type: 'forbidden', permission: 'probe.read' };
    expect(denied(await getDocumentRecord(deps, viewer, secretId))).toEqual(missing);
    expect(denied(await getDocument(deps, viewer, secretId))).toEqual(missing);
    expect(denied(await getDocumentText(deps, viewer, { documentId: secretId }))).toEqual(missing);
    expect(unwrap(await getDocumentRecord(deps, auditor, secretId)).subject).toBe('Streng geheimer Betreff');
    expect(unwrap(await getDocument(deps, auditor, secretId)).protected).toBe(true);
  });

  it('the gate stays shut without dms.view and without any area permission', async () => {
    const { deps, openId } = await setupWithArea();
    const stranger = ctxWith(['contacts.view']);
    expect(denied(await listDocuments(deps, stranger, {}))).toEqual({ type: 'forbidden', permission: 'dms.view' });
    expect(denied(await getDocumentRecord(deps, stranger, openId))).toEqual({ type: 'forbidden', permission: 'dms.view' });
  });

  it('counting unread documents counts only what the caller may read', async () => {
    const { deps, viewer, auditor } = await setupWithArea();
    expect(unwrap(countUnreadDocuments(deps, viewer))).toBe(1);
    expect(unwrap(countUnreadDocuments(deps, auditor))).toBe(1);
  });
});

describe('the other end of a relation', () => {
  it('shows only its number when the caller may not read it', async () => {
    const { deps, all, viewer, auditor, secretId, openId } = await setupWithArea();
    unwrap(await relateDocuments(deps, all, { documentId: openId, relatedDocumentId: secretId, kind: 'repliesTo' }));
    const [seen] = unwrap(await getDocumentRecord(deps, viewer, openId)).relations;
    expect(seen).toMatchObject({ otherId: secretId, otherSubject: '', otherProtected: true });
    expect(seen!.otherNumber).toMatch(/^GEH-/);
    const [full] = unwrap(await getDocumentRecord(deps, all, openId)).relations;
    expect(full).toMatchObject({ otherSubject: 'Streng geheimer Betreff', otherProtected: false });
    // und vom geschützten Ende aus sieht der Prüfer das offene Ende nicht im Klartext
    const [fromSecret] = unwrap(await getDocumentRecord(deps, auditor, secretId)).relations;
    expect(fromSecret).toMatchObject({ otherId: openId, otherSubject: '', otherProtected: true });
  });
});
