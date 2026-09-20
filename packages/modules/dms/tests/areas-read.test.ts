import { unwrap, type Deps } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { documents } from '../src/schema';
import { describe, expect, it } from 'vitest';
import { countDocumentsByFolder, createDocumentFolder, deleteDocumentFolder, listDocumentFolders, listDocumentTypes } from '../src/catalog';
import { DMS_DASHBOARD_TILES } from '../src/dashboard';
import { replaceDocumentText } from '../src/index-store';
import { previewReclassification, receiveDocument } from '../src/incoming';
import { relateDocuments } from '../src/relations';
import { getDocument, getDocumentRecord, listDocuments, moveDocument, previewNextNumber } from '../src/service';
import { countUnreadDocuments, getDocumentText, reindexAllDocuments } from '../src/text';
import { pdfBytes, setupWithArea } from './helpers';

/** Der Schlüssel der eingehenden Beispielart aus `seedTypes`. */
const INCOMING_OPEN_TYPE = 'authority';

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

describe('types, folders and counts', () => {
  async function withFolders() {
    const s = await setupWithArea();
    for (const path of ['Offen', 'Tresor', 'Tresor/2026']) unwrap(await createDocumentFolder(s.deps, s.all, { path }));
    unwrap(await moveDocument(s.deps, s.all, { id: s.openId, folder: 'Offen' }));
    unwrap(await moveDocument(s.deps, s.all, { id: s.secretId, folder: 'Tresor/2026' }));
    return s;
  }

  it('with only an area permission one sees the readable types and the folders that hold such documents', async () => {
    const { deps, viewer, auditor } = await withFolders();
    expect(unwrap(await listDocumentTypes(deps, auditor, {})).map((t) => t.key)).toEqual(['secret']);
    expect(unwrap(await listDocumentTypes(deps, viewer, {})).map((t) => t.key)).toContain('secret');
    expect(unwrap(await listDocumentFolders(deps, auditor)).map((f) => f.path)).toEqual(['Tresor', 'Tresor/2026']);
    expect(unwrap(await listDocumentFolders(deps, viewer)).map((f) => f.path)).toEqual(['Offen', 'Tresor', 'Tresor/2026']);
  });

  it('folder counts count only what the caller may read', async () => {
    const { deps, viewer, auditor } = await withFolders();
    expect(unwrap(await countDocumentsByFolder(deps, viewer))).toEqual({ Offen: 1 });
    expect(unwrap(await countDocumentsByFolder(deps, auditor))).toEqual({ 'Tresor/2026': 1 });
  });

  it('a folder holding only protected documents says so instead of claiming to be not empty', async () => {
    const { deps, viewer } = await withFolders();
    const res = await deleteDocumentFolder(deps, viewer, { path: 'Tresor/2026' });
    expect(res.ok ? null : res.error).toMatchObject({ type: 'conflict', code: 'folderHasProtectedDocuments' });
  });

  it('re-indexing queues and reports only what the caller may read', async () => {
    const { deps, viewer } = await withFolders();
    expect(unwrap(await reindexAllDocuments(deps, viewer)).queued).toBe(1);
  });
});

describe('management without dms.view', () => {
  // Wer nur `dms.manage` hat, verwaltet weiter wie bisher — aber ein geschützter Bereich bleibt zu.
  it('re-indexing and the failed-text tile still cover unprotected documents, and never a protected one', async () => {
    const { deps, secretId, openId } = await setupWithArea();
    const manager = ctxWith(['dms.manage']);
    deps.db.update(documents).set({ textStatus: 'failed' }).where(eq(documents.id, secretId)).run();
    deps.db.update(documents).set({ textStatus: 'failed' }).where(eq(documents.id, openId)).run();
    expect(unwrap(await reindexAllDocuments(deps, manager)).queued).toBe(1);
    deps.db.update(documents).set({ textStatus: 'failed' }).where(eq(documents.id, openId)).run();
    const tile = DMS_DASHBOARD_TILES.find((t) => t.key === 'textFailed')!;
    expect(await tile.load(deps, manager, {})).toMatchObject({ kind: 'count', count: 1 });
  });
});

describe('number preview', () => {
  it('gives no number for a type the caller may not read', async () => {
    const { deps, viewer, auditor } = await setupWithArea();
    expect(unwrap(await previewNextNumber(deps, viewer, { typeKey: 'secret' }))).toEqual({ number: null });
    expect(unwrap(await previewNextNumber(deps, auditor, { typeKey: 'secret' })).number).toMatch(/^GEH-\d{4}-002$/);
  });

  it('reclassifying into such a type previews the retention, not the number', async () => {
    const { deps, all, viewer } = await setupWithArea();
    const doc = unwrap(await receiveDocument(deps, all, { filename: 'x.pdf', typeKey: INCOMING_OPEN_TYPE, subject: 'x', documentDate: '2026-09-01', folder: null, bytes: pdfBytes() }));
    const preview = unwrap(await previewReclassification(deps, viewer, { id: doc.id, typeKey: 'secret', documentDate: '2026-09-01' }));
    expect(preview.number).toMatchObject({ next: null, numberHidden: true });
    expect(preview.retention.next).toBeTruthy();
  });

  it('cannot be asked about a document the caller may not read', async () => {
    const { deps, viewer, secretId } = await setupWithArea();
    const res = await previewReclassification(deps, viewer, { id: secretId, typeKey: INCOMING_OPEN_TYPE, documentDate: '2026-09-01' });
    expect(res.ok ? null : res.error).toEqual({ type: 'forbidden', permission: 'probe.read' });
  });
});
