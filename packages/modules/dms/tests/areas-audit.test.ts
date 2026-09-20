import { schema, unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDocumentFolder } from '../src/catalog';
import { clearDispatch, recordDispatch } from '../src/dispatch';
import { createDraft, deleteDraft, fileDocument, previewDraft, updateDraft } from '../src/drafts';
import { createDocumentFollowUp } from '../src/follow-ups';
import { receiveDocument, reclassifyDocument } from '../src/incoming';
import { addNote, deleteNote } from '../src/notes';
import { relateDocuments, unrelateDocuments } from '../src/relations';
import { documents, documentTypes } from '../src/schema';
import { deleteDocument, linkDocument, moveDocument, unlinkDocument, voidDocument } from '../src/service';
import { INCOMING_OPEN_TYPE, pdfBytes, setupWithArea } from './helpers';

const SUBJECT = 'Streng geheimer Betreff';
const CONTACT = 'CONTACT-0815';
const FREE = ['Widerruf wegen Erbstreit', 'per Boten an Frau Schmidt', 'Müller anrufen'];

describe('the audit log and protected document types (Anhang A)', () => {
  it('carries neither subject nor contact id nor free text, after every service', async () => {
    const { deps, all: base, secretId, openId } = await setupWithArea();
    const all = { ...base, permissions: new Set([...base.permissions, 'followUps.manage', 'followUps.view']) };
    deps.db.update(documentTypes).set({ defaultDirection: 'outgoing' }).where(eq(documentTypes.key, 'secret')).run();
    unwrap(await createDocumentFolder(deps, all, { path: 'Tresor' }));

    // Entwurf: anlegen, ändern, Vorschau, festschreiben, Versand, Storno
    const draft = unwrap(await createDraft(deps, all, { typeKey: 'secret', subject: SUBJECT, body: 'x' }));
    const changed = unwrap(await updateDraft(deps, all, { id: draft.id, subject: `${SUBJECT} 2`, body: 'y' }));
    unwrap(await previewDraft(deps, all, { id: draft.id }));
    const filed = unwrap(await fileDocument(deps, all, { id: changed.id }));
    unwrap(await recordDispatch(deps, all, { id: filed.id, sentAt: '2026-09-05', sentVia: 'post', note: FREE[1] }));
    unwrap(await clearDispatch(deps, all, { id: filed.id }));
    unwrap(await voidDocument(deps, all, { id: filed.id, reason: FREE[0] }));
    const thrown = unwrap(await createDraft(deps, all, { typeKey: 'secret', subject: SUBJECT, body: '' }));
    unwrap(await deleteDraft(deps, all, { id: thrown.id }));

    // Eingang: Bezug, Notiz, Bezug zwischen Dokumenten, Wiedervorlage, Verschieben
    const link = unwrap(await linkDocument(deps, all, { documentId: secretId, entityType: 'contact', entityId: CONTACT, role: 'sender' }));
    unwrap(await unlinkDocument(deps, all, { id: link.id }));
    const note = unwrap(await addNote(deps, all, { documentId: secretId, body: 'intern' }));
    unwrap(await deleteNote(deps, all, { id: note.id }));
    const relation = unwrap(await relateDocuments(deps, all, { documentId: secretId, relatedDocumentId: openId, kind: 'repliesTo' }));
    unwrap(await unrelateDocuments(deps, all, { id: relation.id }));
    unwrap(await createDocumentFollowUp(deps, all, { documentId: secretId, dueAt: '2026-10-01', title: FREE[2] }));
    unwrap(await moveDocument(deps, all, { id: secretId, folder: 'Tresor' }));

    // Umklassifizieren: hinein und hinaus
    deps.db.update(documentTypes).set({ defaultDirection: 'incoming' }).where(eq(documentTypes.key, 'secret')).run();
    const incoming = unwrap(await receiveDocument(deps, all, { filename: 'p.pdf', typeKey: INCOMING_OPEN_TYPE, subject: SUBJECT, documentDate: '2026-09-01', folder: null, bytes: pdfBytes() }));
    const before = deps.db.select().from(schema.auditLog).all().length;
    const into = unwrap(await reclassifyDocument(deps, all, { id: incoming.id, typeKey: 'secret', subject: SUBJECT, documentDate: '2026-09-01', expectedVersion: incoming.updatedAt }));
    unwrap(await reclassifyDocument(deps, all, { id: into.id, typeKey: INCOMING_OPEN_TYPE, subject: SUBJECT, documentDate: '2026-09-01', expectedVersion: into.updatedAt }));

    // Fristlöschung
    deps.db.update(documents).set({ documentDate: '2001-01-01' }).where(eq(documents.id, secretId)).run();
    unwrap(await deleteDocument(deps, all, { id: secretId }));

    const log = deps.db.select().from(schema.auditLog).all();
    // Alles vor dem freien Eingang `incoming` betrifft nur geschützte Dokumente …
    const guarded = [...log.slice(0, before - 1), ...log.slice(before)];
    const text = JSON.stringify(guarded);
    for (const secret of [SUBJECT, CONTACT, ...FREE]) expect(text, secret).not.toContain(secret);
    // … und nennt sie trotzdem: Nummer, oder bei Entwürfen ID und Art.
    expect(text).toContain(filed.number);
    expect(text).toContain(`Entwurf ${thrown.id} (secret)`);
    expect(guarded.map((e) => e.action)).toEqual(expect.arrayContaining(['dms.draft.create', 'dms.draft.update', 'dms.draft.preview', 'dms.draft.delete', 'dms.file', 'dms.dispatch', 'dms.dispatch.clear', 'dms.void', 'dms.link', 'dms.unlink', 'dms.note.add', 'dms.note.delete', 'dms.relate', 'dms.unrelate', 'dms.move', 'dms.reclassify', 'dms.delete']));
  });

  it('leaves every entry of an unprotected document word for word as it was', async () => {
    const { deps, all } = await setupWithArea();
    unwrap(await createDraft(deps, all, { typeKey: 'letter', subject: 'Offener Brief', body: '' }));
    expect(deps.db.select().from(schema.auditLog).all().at(-1)).toMatchObject({ action: 'dms.draft.create', summary: 'Entwurf „Offener Brief“ angelegt' });
  });
});
