import { coreModule, schema } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { dmsModule } from '../src/manifest';
import { documentLinks, documentTypes, documents } from '../src/schema';
import { getDocument, listDocuments, nextDocumentNumber, voidDocument } from '../src/service';

const ALL = ['dms.view', 'dms.create', 'dms.file', 'dms.void', 'dms.deleteDraft', 'dms.manage'];

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule] });
  const userId = insertUser(deps, {});
  deps.db.insert(documentTypes).values({ key: 'letter', label: 'Brief', prefix: 'BRF', defaultDirection: 'outgoing', retentionClass: 'statutory6Y', isActive: true, sortOrder: 0 }).run();
  return { deps, ctx: ctxWith(ALL, userId), userId };
}

/** Ein festgeschriebenes Dokument, direkt in die Tabelle gelegt (createDraft/fileDocument kommen erst mit Plan 2). */
async function insertIssued(deps: ReturnType<typeof createTestDeps>, userId: string, overrides: Partial<typeof documents.$inferInsert> = {}) {
  const id = overrides.id ?? `doc-${Math.random().toString(36).slice(2)}`;
  const bytes = new TextEncoder().encode(`%PDF-fake ${id}`);
  await deps.media.write(`${id}.pdf`, bytes);
  deps.db
    .insert(schema.mediaAssets)
    .values({ id: `${id}-asset`, filename: `${id}.pdf`, mimeType: 'application/pdf', bytes: bytes.byteLength, uploadedByUserId: userId, createdAt: '2026-09-10T00:00:00.000Z' })
    .run();
  deps.db
    .insert(documents)
    .values({
      id,
      phase: 'issued',
      direction: 'outgoing',
      sourceKind: 'generated',
      typeKey: 'letter',
      number: overrides.number ?? `BRF-2026-${id.slice(-3)}`,
      subject: 'Einladung',
      documentDate: '2026-09-10',
      assetId: `${id}-asset`,
      status: 'issued',
      createdByUserId: userId,
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
      ...overrides,
    })
    .run();
  return id;
}

describe('documents', () => {
  it('führt Entwürfe ohne Nummer und festgeschriebene mit', () => {
    const { deps, userId } = setup();
    deps.db.insert(documents).values({
      id: 'doc-draft', phase: 'draft', direction: 'outgoing', sourceKind: 'generated',
      typeKey: 'letter', number: null, subject: 'Entwurf', documentDate: '2026-09-10',
      draftBody: '# Hallo', createdByUserId: userId, createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    }).run();
    const row = deps.db.select().from(documents).get();
    expect(row?.number).toBeNull();
    expect(row?.assetId).toBeNull();
  });

  describe('nextDocumentNumber', () => {
    it('vergibt lückenlos je Präfix und Jahr', async () => {
      const { deps, userId } = setup();
      expect(nextDocumentNumber(deps.db, 'BRF', 2026)).toBe('BRF-2026-001');
      await insertIssued(deps, userId, { id: 'doc-1', number: 'BRF-2026-001' });
      expect(nextDocumentNumber(deps.db, 'BRF', 2026)).toBe('BRF-2026-002');
      await insertIssued(deps, userId, { id: 'doc-2', number: 'BRF-2026-002' });
      expect(nextDocumentNumber(deps.db, 'BRF', 2026)).toBe('BRF-2026-003');
      // Anderes Jahr, eigener Kreis.
      expect(nextDocumentNumber(deps.db, 'BRF', 2027)).toBe('BRF-2027-001');
    });
  });

  describe('listDocuments', () => {
    it('listet nur, wer dms.view hat', async () => {
      const { deps } = setup();
      const result = await listDocuments(deps, ctxWith([]), {});
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.type === 'forbidden').toBe(true);
    });

    it('validiert die Eingabe', async () => {
      const { deps, ctx } = setup();
      const bad = await listDocuments(deps, ctx, { direction: 'sideways' });
      expect(bad.ok === false && bad.error.type === 'validation').toBe(true);
    });

    it('filtert nach Richtung, Art, Ordner, Eingangskorb, Text und Bezug', async () => {
      const { deps, ctx, userId } = setup();
      const a = await insertIssued(deps, userId, { id: 'doc-a', number: 'BRF-2026-001', subject: 'Einladung Mitgliederversammlung', folder: 'vorstand' });
      await insertIssued(deps, userId, { id: 'doc-b', number: 'BRF-2026-002', subject: 'Kündigung', folder: null });
      deps.db.insert(documentLinks).values({ id: 'link-1', documentId: a, entityType: 'contact', entityId: 'C1', role: 'recipient', createdAt: '2026-09-10T00:00:00.000Z' }).run();

      const all = await listDocuments(deps, ctx, {});
      expect(all.ok && all.value.total).toBe(2);

      const inbox = await listDocuments(deps, ctx, { inbox: true });
      expect(inbox.ok && inbox.value.documents.map((d) => d.id)).toEqual(['doc-b']);

      const byText = await listDocuments(deps, ctx, { text: 'Kündigung' });
      expect(byText.ok && byText.value.documents.map((d) => d.id)).toEqual(['doc-b']);

      const byFolder = await listDocuments(deps, ctx, { folder: 'vorstand' });
      expect(byFolder.ok && byFolder.value.documents.map((d) => d.id)).toEqual(['doc-a']);

      const byLink = await listDocuments(deps, ctx, { linkedTo: { entityType: 'contact', entityId: 'C1' } });
      expect(byLink.ok && byLink.value.documents.map((d) => d.id)).toEqual(['doc-a']);
      expect(byLink.ok && byLink.value.documents[0]!.links).toHaveLength(1);
    });
  });

  describe('getDocument', () => {
    it('liest die Datei zurück, verweigert ohne Recht und meldet Unbekanntes', async () => {
      const { deps, ctx, userId } = setup();
      const id = await insertIssued(deps, userId);
      const got = await getDocument(deps, ctx, id);
      expect(got.ok).toBe(true);
      expect(got.ok && got.value.record.id).toBe(id);
      expect(got.ok && got.value.filename.endsWith('.pdf')).toBe(true);

      const denied = await getDocument(deps, ctxWith([]), id);
      expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);

      const missing = await getDocument(deps, ctx, 'gibtsnicht');
      expect(missing.ok === false && missing.error.type === 'notFound').toBe(true);
    });
  });

  describe('voidDocument', () => {
    it('storniert einmal, verweigert ohne Recht, validiert und protokolliert', async () => {
      const { deps, ctx, userId } = setup();
      const id = await insertIssued(deps, userId);
      const voided = await voidDocument(deps, ctx, { id, reason: 'Tippfehler' });
      expect(voided.ok).toBe(true);
      expect(voided.ok && voided.value.status).toBe('voided');

      const again = await voidDocument(deps, ctx, { id, reason: 'nochmal' });
      expect(again.ok === false && again.error.type === 'conflict' && again.error.code === 'documentAlreadyVoided').toBe(true);

      const bad = await voidDocument(deps, ctx, { id: 'x', reason: '' });
      expect(bad.ok === false && bad.error.type === 'validation').toBe(true);

      const denied = await voidDocument(deps, ctxWith([]), { id, reason: 'x' });
      expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);

      const audit = deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'dms.void');
      expect(audit).toHaveLength(1);
    });
  });
});
