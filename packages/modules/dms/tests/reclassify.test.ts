import { schema, unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { receiveDocument, previewReclassification, reclassifyDocument } from '../src/incoming';
import { deleteDocument, getDocumentRecord, listDocuments, voidDocument } from '../src/service';
import { fileFixture, pdfBytes, setupWithTypes } from './helpers';

/**
 * Spec 2026-09-19-umklassifizieren: Ein eingehendes Dokument bekommt
 * nachträglich Art, Betreff oder Datum neu. Wechselt die Art, zieht es eine
 * neue Nummer aus deren Präfix; die alte bleibt vermerkt und auffindbar.
 */
async function received(deps: Parameters<typeof receiveDocument>[0], ctx: Parameters<typeof receiveDocument>[1], typeKey = 'contract') {
  return unwrap(await receiveDocument(deps, ctx, { filename: 'post.pdf', bytes: pdfBytes(), typeKey, subject: 'Schreiben', documentDate: '2026-03-14' }));
}

describe('reclassifyDocument', () => {
  it('zieht bei neuer Art eine neue Nummer aus deren Präfix und vermerkt die alte', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await received(deps, ctx);
    expect(doc.number).toBe('VER-2026-001');

    const after = unwrap(await reclassifyDocument(deps, ctx, { id: doc.id, typeKey: 'authority', expectedVersion: doc.updatedAt }));

    expect(after.typeKey).toBe('authority');
    expect(after.number).toBe('BEH-2026-001');
    expect(after.formerNumbers).toEqual(['VER-2026-001']);
    const entry = auditEntry(deps, 'dms.reclassify');
    expect(entry).toMatchObject({ entityType: 'document', entityId: doc.id });
    expect(entry.summary).toContain('VER-2026-001');
    expect(entry.summary).toContain('BEH-2026-001');
  });

  it('ändert nur Betreff und Datum, ohne die Nummer anzufassen', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await received(deps, ctx);
    const after = unwrap(await reclassifyDocument(deps, ctx, { id: doc.id, subject: 'Mietvertrag Lager', documentDate: '2026-03-01' }));
    expect(after).toMatchObject({ number: 'VER-2026-001', subject: 'Mietvertrag Lager', documentDate: '2026-03-01', formerNumbers: [] });
  });

  it('merkt sich jede frühere Nummer, die älteste zuerst', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await received(deps, ctx);
    unwrap(await reclassifyDocument(deps, ctx, { id: doc.id, typeKey: 'authority' }));
    const after = unwrap(await reclassifyDocument(deps, ctx, { id: doc.id, typeKey: 'invoice' }));
    expect(after.number).toBe('RCH-2026-001');
    expect(after.formerNumbers).toEqual(['VER-2026-001', 'BEH-2026-001']);
  });

  it('bleibt in der Reihe des Ablagejahrs, auch wenn es später umklassifiziert wird', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await received(deps, ctx);
    deps.clock.set('2027-01-10T09:00:00.000Z');
    const after = unwrap(await reclassifyDocument(deps, ctx, { id: doc.id, typeKey: 'authority' }));
    expect(after.number).toBe('BEH-2026-001');
  });

  it('schreibt nichts, wenn sich nichts ändert', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await received(deps, ctx);
    const before = deps.db.select().from(schema.auditLog).all().length;
    const after = unwrap(await reclassifyDocument(deps, ctx, { id: doc.id, typeKey: 'contract', subject: 'Schreiben' }));
    expect(after.updatedAt).toBe(doc.updatedAt);
    expect(deps.db.select().from(schema.auditLog).all()).toHaveLength(before);
  });

  it('verlangt dms.create', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await received(deps, ctx);
    const result = await reclassifyDocument(deps, ctxWith(['dms.view'], ctx.userId!), { id: doc.id, subject: 'X' });
    expect(result.ok === false && result.error.type).toBe('forbidden');
  });

  it('prüft die Eingabe', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await received(deps, ctx);
    const result = await reclassifyDocument(deps, ctx, { id: doc.id, documentDate: '14.03.2026' });
    expect(result.ok === false && result.error.type).toBe('validation');
  });

  it('kennt weder unbekannte Dokumente noch unbekannte Arten', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await received(deps, ctx);
    expect((await reclassifyDocument(deps, ctx, { id: 'NOPE', subject: 'X' })).ok === false).toBe(true);
    const unknownType = await reclassifyDocument(deps, ctx, { id: doc.id, typeKey: 'gibt-es-nicht' });
    expect(unknownType.ok === false && unknownType.error.type).toBe('notFound');
  });

  it('lässt ausgehende Dokumente in Ruhe — ihre Nummer steht im verschickten PDF', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const result = await reclassifyDocument(deps, ctx, { id: letter.id, subject: 'Anders' });
    expect(result).toMatchObject({ ok: false, error: { type: 'conflict', code: 'notIncoming' } });
  });

  it('lässt stornierte Dokumente in Ruhe', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await received(deps, ctx);
    unwrap(await voidDocument(deps, ctx, { id: doc.id, reason: 'doppelt' }));
    const result = await reclassifyDocument(deps, ctx, { id: doc.id, subject: 'Anders' });
    expect(result).toMatchObject({ ok: false, error: { type: 'conflict', code: 'documentVoided' } });
  });

  it('weist ein Speichern auf veraltetem Stand ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await received(deps, ctx);
    deps.clock.advance(60_000);
    unwrap(await reclassifyDocument(deps, ctx, { id: doc.id, subject: 'Zwischendurch' }));
    const stale = await reclassifyDocument(deps, ctx, { id: doc.id, typeKey: 'authority', expectedVersion: doc.updatedAt });
    expect(stale).toMatchObject({ ok: false, error: { type: 'conflict', code: 'staleVersion' } });
  });
});

describe('frühere Nummern', () => {
  it('findet die Suche das Dokument auch unter seiner alten Nummer', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await received(deps, ctx);
    unwrap(await reclassifyDocument(deps, ctx, { id: doc.id, typeKey: 'authority' }));
    const found = unwrap(await listDocuments(deps, ctx, { text: 'VER-2026-001' }));
    expect(found.documents.map((d) => d.id)).toEqual([doc.id]);
  });

  it('gehen mit dem Dokument, wenn es nach Fristablauf gelöscht wird', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await received(deps, ctx);
    unwrap(await reclassifyDocument(deps, ctx, { id: doc.id, typeKey: 'authority', documentDate: '2010-01-01' }));
    unwrap(await deleteDocument(deps, ctx, { id: doc.id }));
    expect((await getDocumentRecord(deps, ctx, doc.id)).ok).toBe(false);
    expect(unwrap(await listDocuments(deps, ctx, { text: 'VER-2026-001' })).documents).toEqual([]);
  });
});

describe('previewReclassification', () => {
  it('nennt die künftige Nummer und beide Fristen und schreibt nichts', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await received(deps, ctx, 'contract');
    const auditBefore = deps.db.select().from(schema.auditLog).all().length;

    const preview = unwrap(await previewReclassification(deps, ctx, { id: doc.id, typeKey: 'letter', documentDate: '2026-03-14' }));

    expect(preview).toMatchObject({
      number: { current: 'VER-2026-001', next: 'BRF-2026-001' },
      retention: { current: { retentionClass: 'statutory10Y' }, next: { retentionClass: 'statutory6Y' } },
    });
    expect(preview.retention.current.until).not.toBe(preview.retention.next.until);
    expect(unwrap(await getDocumentRecord(deps, ctx, doc.id)).number).toBe('VER-2026-001');
    expect(deps.db.select().from(schema.auditLog).all()).toHaveLength(auditBefore);
  });

  it('nennt keine neue Nummer, solange die Art bleibt', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await received(deps, ctx);
    const preview = unwrap(await previewReclassification(deps, ctx, { id: doc.id, typeKey: 'contract', documentDate: '2026-03-14' }));
    expect(preview.number).toEqual({ current: 'VER-2026-001', next: null });
  });
});
