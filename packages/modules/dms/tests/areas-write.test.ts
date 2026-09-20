import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as dms from '../src/index';
import { createDocumentFolder, deleteDocumentFolder } from '../src/catalog';
import { clearDispatch, recordDispatch } from '../src/dispatch';
import { createDraft, createReplacementDraft, deleteDraft, fileDocument, updateDraft } from '../src/drafts';
import { createDocumentFollowUp } from '../src/follow-ups';
import { receiveDocument, reclassifyDocument } from '../src/incoming';
import { addNote, deleteNote } from '../src/notes';
import { relateDocuments, unrelateDocuments } from '../src/relations';
import { documentTypes } from '../src/schema';
import { deleteDocument, linkDocument, moveDocument, unlinkDocument, voidDocument } from '../src/service';
import { INCOMING_OPEN_TYPE, pdfBytes, setupWithArea } from './helpers';

type Ctx = Awaited<ReturnType<typeof setupWithArea>>['viewer'];

describe('write services and protected document types', () => {
  async function fixture() {
    const s = await setupWithArea();
    const all = { ...s.all, permissions: new Set([...s.all.permissions, 'followUps.manage']) };
    const viewer = { ...s.viewer, permissions: new Set([...s.viewer.permissions, 'followUps.manage']) };
    const link = unwrap(await linkDocument(s.deps, all, { documentId: s.secretId, entityType: 'animal', entityId: 'A1', role: 'about' }));
    const note = unwrap(await addNote(s.deps, all, { documentId: s.secretId, body: 'intern' }));
    const relation = unwrap(await relateDocuments(s.deps, all, { documentId: s.openId, relatedDocumentId: s.secretId, kind: 'repliesTo' }));
    s.deps.db.update(documentTypes).set({ defaultDirection: 'outgoing' }).where(eq(documentTypes.key, 'secret')).run();
    const draft = unwrap(await createDraft(s.deps, all, { typeKey: 'secret', subject: 'Entwurf', body: '' }));
    return { ...s, all, viewer, linkId: link.id, noteId: note.id, relationId: relation.id, draftId: draft.id };
  }

  /** Jeder Dienst, der ein vorhandenes Dokument ändert — mit einer Eingabe, die das geschützte träfe. */
  const WRITES: Record<string, (f: Awaited<ReturnType<typeof fixture>>, ctx: Ctx) => Promise<{ ok: boolean; error?: unknown }>> = {
    voidDocument: (f, c) => voidDocument(f.deps, c, { id: f.secretId, reason: 'x' }),
    moveDocument: (f, c) => moveDocument(f.deps, c, { id: f.secretId, folder: null }),
    linkDocument: (f, c) => linkDocument(f.deps, c, { documentId: f.secretId, entityType: 'animal', entityId: 'A2', role: 'about' }),
    unlinkDocument: (f, c) => unlinkDocument(f.deps, c, { id: f.linkId }),
    deleteDocument: (f, c) => deleteDocument(f.deps, c, { id: f.secretId }),
    updateDraft: (f, c) => updateDraft(f.deps, c, { id: f.draftId, subject: 'neu', body: '' }),
    deleteDraft: (f, c) => deleteDraft(f.deps, c, { id: f.draftId }),
    fileDocument: (f, c) => fileDocument(f.deps, c, { id: f.draftId }),
    createReplacementDraft: (f, c) => createReplacementDraft(f.deps, c, { voidedId: f.secretId }),
    reclassifyDocument: (f, c) => reclassifyDocument(f.deps, c, { id: f.secretId, typeKey: INCOMING_OPEN_TYPE, subject: 'x', documentDate: '2026-09-01' }),
    relateDocuments: (f, c) => relateDocuments(f.deps, c, { documentId: f.openId, relatedDocumentId: f.secretId, kind: 'replaces' }),
    unrelateDocuments: (f, c) => unrelateDocuments(f.deps, c, { id: f.relationId }),
    addNote: (f, c) => addNote(f.deps, c, { documentId: f.secretId, body: 'x' }),
    deleteNote: (f, c) => deleteNote(f.deps, c, { id: f.noteId }),
    recordDispatch: (f, c) => recordDispatch(f.deps, c, { id: f.secretId, sentAt: '2026-09-02', sentVia: 'post' }),
    clearDispatch: (f, c) => clearDispatch(f.deps, c, { id: f.secretId }),
    createDocumentFollowUp: (f, c) => createDocumentFollowUp(f.deps, c, { documentId: f.secretId, dueAt: '2026-10-01', title: 'x' }),
  };

  for (const name of Object.keys(WRITES)) {
    it(`${name} answers forbidden for a document the caller may not read`, async () => {
      const f = await fixture();
      const res = await WRITES[name]!(f, f.viewer);
      expect(res.ok ? 'ok' : res.error).toEqual({ type: 'forbidden', permission: 'probe.read' });
    });
  }

  it('receiving with a relation to an unreadable document is refused as well', async () => {
    const f = await fixture();
    const res = await receiveDocument(f.deps, f.viewer, { filename: 'a.pdf', typeKey: INCOMING_OPEN_TYPE, subject: 'Antwort', documentDate: '2026-09-01', folder: null, bytes: pdfBytes(), relations: [{ relatedDocumentId: f.secretId, kind: 'repliesTo' }] });
    expect(res.ok ? 'ok' : res.error).toEqual({ type: 'forbidden', permission: 'probe.read' });
  });

  it('a caller with dms.create but without dms.view still works on unprotected documents', async () => {
    const { deps, openId } = await setupWithArea();
    const res = await addNote(deps, ctxWith(['dms.create']), { documentId: openId, body: 'x' });
    expect(res.ok).toBe(true);
  });

  it('a folder with only unprotected documents is “not empty” for a caller with dms.manage alone', async () => {
    const { deps, all, openId } = await setupWithArea();
    unwrap(await createDocumentFolder(deps, all, { path: 'Offen' }));
    unwrap(await moveDocument(deps, all, { id: openId, folder: 'Offen' }));
    const res = await deleteDocumentFolder(deps, ctxWith(['dms.manage']), { path: 'Offen' });
    expect(res.ok ? null : res.error).toMatchObject({ type: 'conflict', code: 'folderNotEmpty' });
  });

  it('the list above is complete: every exported service is a read, a write, or exempt with a reason', () => {
    const READS = ['listDocuments', 'getDocumentRecord', 'getDocument', 'getDocumentText', 'countUnreadDocuments', 'previewDraft', 'previewNextNumber', 'previewReclassification', 'listDocumentTypes', 'listDocumentFolders', 'countDocumentsByFolder', 'listDocumentRules', 'listSnippets', 'suggestClassification', 'readLinkedDocument', 'listDocumentAreas', 'countDocumentsOfType'];
    const EXEMPT: Record<string, string> = {
      createDraft: 'legt an; verlangt bei geschützter Art das Bereichsrecht (Task 4)',
      receiveDocument: 'legt an; Ablegen in eine geschützte Art ist erlaubt (Task 4)',
      receiveGeneratedUpload: 'legt an, im Namen eines Vorgangs',
      issueGeneratedDocument: 'legt an, unter dem Recht der Vorlage',
      storeIncoming: 'Innenleben der beiden Eingänge',
      requireDmsGate: 'Rechteprüfung für die Seiten der Akte, kein Dienst',
      canReadDocumentType: 'Rechteprüfung für die Seiten der Akte, kein Dienst',
      seedDms: 'seed-Haken',
      extractDocumentText: 'gibt keinen Inhalt aus; der Text-Worker könnte geschützte Dokumente sonst nie indizieren',
      reindexAllDocuments: 'läuft über manageableTypeFilter (VP3a)',
      createDocumentType: 'Katalog', updateDocumentType: 'Katalog, V14 in Task 5', createDocumentFolder: 'Katalog', deleteDocumentFolder: 'Katalog, achtet geschützte Dokumente (VP3a)',
      createDocumentRule: 'Katalog', updateDocumentRule: 'Katalog', deleteDocumentRule: 'Katalog', createSnippet: 'Katalog', updateSnippet: 'Katalog', deleteSnippet: 'Katalog',
    };
    const services = Object.entries(dms).filter(([, v]) => typeof v === 'function' && /^(async\s+)?function\s*\w*\s*\(\s*deps\s*,\s*ctx\b/.test(String(v))).map(([name]) => name);
    const unknown = services.filter((name) => !(name in WRITES) && !READS.includes(name) && !(name in EXEMPT));
    expect(unknown).toEqual([]);
  });
});

describe('creating without the area permission', () => {
  it('a draft in a protected type asks for the area permission', async () => {
    const { deps, viewer } = await setupWithArea();
    deps.db.update(documentTypes).set({ defaultDirection: 'outgoing' }).where(eq(documentTypes.key, 'secret')).run();
    const res = await createDraft(deps, viewer, { typeKey: 'secret', subject: 'x', body: '' });
    expect(res.ok ? 'ok' : res.error).toEqual({ type: 'forbidden', permission: 'probe.read' });
  });

  it('filing into a protected type is allowed — and the document is gone from the filer’s sight', async () => {
    const { deps, viewer } = await setupWithArea();
    const filed = unwrap(await receiveDocument(deps, viewer, { filename: 'r.pdf', typeKey: 'secret', subject: 'Rechnung', documentDate: '2026-09-01', folder: null, bytes: pdfBytes() }));
    expect(filed.number).toMatch(/^GEH-/);
    expect(unwrap(await dms.listDocuments(deps, viewer, {})).documents.map((d) => d.id)).not.toContain(filed.id);
  });

  it('reclassifying into a protected type is allowed, out of one it is not', async () => {
    const { deps, viewer } = await setupWithArea();
    const open = unwrap(await receiveDocument(deps, viewer, { filename: 'r.pdf', typeKey: INCOMING_OPEN_TYPE, subject: 'Rechnung', documentDate: '2026-09-01', folder: null, bytes: pdfBytes() }));
    const moved = unwrap(await reclassifyDocument(deps, viewer, { id: open.id, typeKey: 'secret', subject: 'Rechnung', documentDate: '2026-09-01', expectedVersion: open.updatedAt }));
    expect(moved.number).toMatch(/^GEH-/);
    const back = await reclassifyDocument(deps, viewer, { id: open.id, typeKey: INCOMING_OPEN_TYPE, subject: 'Rechnung', documentDate: '2026-09-01' });
    expect(back.ok ? 'ok' : back.error).toEqual({ type: 'forbidden', permission: 'probe.read' });
  });

  it('canReadDocumentType tells the pages whether the caller will see what they filed', async () => {
    const { deps, viewer, auditor } = await setupWithArea();
    expect([dms.canReadDocumentType(deps, viewer, 'secret'), dms.canReadDocumentType(deps, auditor, 'secret'), dms.canReadDocumentType(deps, viewer, INCOMING_OPEN_TYPE), dms.canReadDocumentType(deps, viewer, 'nope')]).toEqual([false, true, true, false]);
  });
});
