import { unwrap, type CallContext, type Deps } from '@kompass/core';
import { ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createDocumentFolder } from '../src/catalog';
import { recordDispatch } from '../src/dispatch';
import { createDraft, fileDocument } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { relateDocuments } from '../src/relations';
import { listDocuments } from '../src/service';
import { ALL_DMS, pdfBytes, setupWithTypes } from './helpers';

async function issued(deps: Deps, ctx: CallContext, subject: string) {
  const d = await createDraft(deps, ctx, { typeKey: 'letter', subject, body: 'x' });
  if (!d.ok) throw new Error('draft');
  const f = await fileDocument(deps, ctx, { id: d.value.id });
  if (!f.ok) throw new Error('file');
  return f.value;
}

describe('listDocuments: Sortierung und Filter', () => {
  it('validiert die Eingabe', async () => {
    const { deps, ctx } = setupWithTypes();
    const bad = await listDocuments(deps, ctx, { direction: 'sideways' });
    expect(bad.ok === false && bad.error.type).toBe('validation');
  });

  it('filtert nach Ordner, Eingangskorb, Text und Bezug', async () => {
    const { deps, ctx } = setupWithTypes();
    unwrap(await createDocumentFolder(deps, ctx, { path: 'vorstand' }));
    const a = unwrap(await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'Einladung Mitgliederversammlung', documentDate: '2026-09-01', folder: 'vorstand', links: [{ entityType: 'contact', entityId: 'C1', role: 'sender' }] }));
    const b = unwrap(await receiveDocument(deps, ctx, { filename: 'b.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'Kündigung', documentDate: '2026-09-02', folder: null }));
    const ids = async (input: object) => {
      const r = unwrap(await listDocuments(deps, ctx, input));
      return r.documents.map((d) => d.id);
    };
    expect((await ids({})).sort()).toEqual([a.id, b.id].sort());
    expect(await ids({ inbox: true })).toEqual([b.id]);
    expect(await ids({ text: 'Kündigung' })).toEqual([b.id]);
    expect(await ids({ folder: 'vorstand' })).toEqual([a.id]);
    const byLink = unwrap(await listDocuments(deps, ctx, { linkedTo: { entityType: 'contact', entityId: 'C1' } }));
    expect(byLink.documents.map((d) => d.id)).toEqual([a.id]);
    expect(byLink.documents[0]!.links).toHaveLength(1);
  });

  it('liefert mit createdByUserId nur Entwürfe des genannten Verfassers', async () => {
    const { deps, ctx, userId } = setupWithTypes();
    const other = ctxWith(ALL_DMS, insertUser(deps, { name: 'Andere', email: 'andere@kompass.local' }));
    await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Meiner', body: 'x' });
    await createDraft(deps, other, { typeKey: 'letter', subject: 'Fremder', body: 'x' });
    const mine = await listDocuments(deps, ctx, { phase: 'draft', createdByUserId: userId });
    expect(mine.ok && mine.value.documents.map((d) => d.subject)).toEqual(['Meiner']);
    expect(mine.ok && mine.value.total).toBe(1);
  });

  it('sortiert nach Betreff in beide Richtungen, ohne Parameter chronologisch', async () => {
    const { deps, ctx } = setupWithTypes();
    await issued(deps, ctx, 'Zebra');
    await issued(deps, ctx, 'Apfel');
    const asc = await listDocuments(deps, ctx, { orderBy: { field: 'subject', direction: 'asc' } });
    expect(asc.ok && asc.value.documents.map((d) => d.subject)).toEqual(['Apfel', 'Zebra']);
    const desc = await listDocuments(deps, ctx, { orderBy: { field: 'subject', direction: 'desc' } });
    expect(desc.ok && desc.value.documents.map((d) => d.subject)).toEqual(['Zebra', 'Apfel']);
    const plain = await listDocuments(deps, ctx, {});
    expect(plain.ok && plain.value.documents.map((d) => d.subject)).toEqual(['Apfel', 'Zebra']); // jüngste zuerst
    const bad = await listDocuments(deps, ctx, { orderBy: { field: 'draftBody', direction: 'asc' } });
    expect(bad.ok).toBe(false);
  });

  it('„nicht versandt“ meint ausgehend, festgeschrieben, ohne Vermerk', async () => {
    const { deps, ctx } = setupWithTypes();
    const sent = await issued(deps, ctx, 'versandt');
    await recordDispatch(deps, ctx, { id: sent.id, sentAt: '2026-09-05', sentVia: 'post' });
    await issued(deps, ctx, 'liegt noch');
    await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Entwurf', body: 'x' });
    await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'Eingang', documentDate: '2026-09-01' });
    const unsent = await listDocuments(deps, ctx, { unsent: true });
    expect(unsent.ok && unsent.value.documents.map((d) => d.subject)).toEqual(['liegt noch']);
  });

  /**
   * Der Eingangskorb ist Post, die noch nicht einsortiert ist — nicht alles,
   * was keinen Ordner hat. Ein Brief ohne Ordner ist ein Brief ohne Ordner
   * (Nachtrag zu Entscheidung 20, 2026-09-12).
   */
  it('der Eingangskorb enthält nur Eingänge ohne Ordner', async () => {
    const { deps, ctx } = setupWithTypes();
    await issued(deps, ctx, 'Ausgang ohne Ordner');
    await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Entwurf ohne Ordner', body: 'x' });
    await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'Eingang', documentDate: '2026-09-01' });
    const inbox = await listDocuments(deps, ctx, { inbox: true });
    expect(inbox.ok && inbox.value.documents.map((d) => d.subject)).toEqual(['Eingang']);
    expect(inbox.ok && inbox.value.total).toBe(1);
  });

  it('„relatedTo“ liefert die Dokumente an beiden Enden eines Bezugs', async () => {
    const { deps, ctx } = setupWithTypes();
    const a = await issued(deps, ctx, 'a');
    const b = await issued(deps, ctx, 'b');
    await issued(deps, ctx, 'c');
    await relateDocuments(deps, ctx, { documentId: b.id, relatedDocumentId: a.id, kind: 'repliesTo' });
    const ofA = await listDocuments(deps, ctx, { relatedTo: a.id });
    expect(ofA.ok && ofA.value.documents.map((d) => d.subject)).toEqual(['b']);
    const ofB = await listDocuments(deps, ctx, { relatedTo: b.id });
    expect(ofB.ok && ofB.value.documents.map((d) => d.subject)).toEqual(['a']);
  });
});
