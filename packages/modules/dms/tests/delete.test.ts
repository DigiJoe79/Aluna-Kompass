import { coreModule, defineModule, unwrap, writeSettingInternal, type CallContext, type Deps } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDocumentFollowUp } from '../src/follow-ups';
import { receiveDocument } from '../src/incoming';
import { dmsModule } from '../src/manifest';
import { documentLinks, documents } from '../src/schema';
import { deleteDocument } from '../src/service';
import { ALL_DMS, auditActions, pdfBytes, seedTypes, setupWithTypes } from './helpers';

const code = (r: { ok: boolean; error?: { type: string; code?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);
const subjectOf = (deps: Deps, id: string) => deps.db.select().from(documents).where(eq(documents.id, id)).get()?.subject;

const deleted: string[] = [];
const probe = defineModule({
  key: 'probe',
  version: '0.0.0',
  permissions: [],
  retentionHolds: (deps, entityType, id) => (entityType === 'document' && subjectOf(deps, id) === 'gehalten' ? [{ label: 'Buchung 2026-0042', until: '2099-12-31', entity: 'probeEntry', id: 'E1' }] : []),
  recordReferences: (deps, entityType, id) => (entityType === 'document' && subjectOf(deps, id) === 'verwiesen' ? [{ label: 'Buchung 2026-0043', entity: 'probeEntry', id: 'E2' }] : []),
  recordDeleted: (_tx, _deps, _ctx, entityType, id) => void deleted.push(`${entityType}:${id}`),
});

function setupWithProbe() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule, probe] });
  seedTypes(deps);
  const userId = insertUser(deps, { name: 'Test', email: 'test@kompass.local' });
  const ctx = ctxWith([...ALL_DMS, 'contacts.manage', 'settings.manage'], userId);
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctx, 'modules.enabled', ['dms', 'probe'], 'test.enable');
  });
  return { deps, ctx, userId };
}

describe('deleteDocument', () => {
  it('lehnt ab, solange die Frist läuft', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await receiveDocument(deps, ctx, {
      filename: 'neu.pdf',
      bytes: pdfBytes(),
      typeKey: 'invoice',
      subject: 'Neu',
      documentDate: '2026-01-01',
    });
    if (!doc.ok) throw new Error('setup');
    const result = await deleteDocument(deps, ctx, { id: doc.value.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('conflict');
  });

  it('löscht, wenn die Frist abgelaufen ist — samt Datei und Bezügen', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await receiveDocument(deps, ctx, {
      filename: 'alt.pdf',
      bytes: pdfBytes(),
      typeKey: 'invoice',
      subject: 'Alt',
      documentDate: '2005-06-01',
    });
    if (!doc.ok) throw new Error('setup');
    const result = await deleteDocument(deps, ctx, { id: doc.value.id });
    expect(result.ok).toBe(true);
    expect(deps.db.select().from(documents).all()).toHaveLength(0);
    expect(deps.db.select().from(documentLinks).all()).toHaveLength(0);
    expect(auditActions(deps)).toContain('dms.delete');
  });

  it('verlangt dms.manage', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await receiveDocument(deps, ctx, {
      filename: 'alt.pdf',
      bytes: pdfBytes(),
      typeKey: 'invoice',
      subject: 'Alt',
      documentDate: '2005-06-01',
    });
    if (!doc.ok) throw new Error('setup');
    const denied = await deleteDocument(
      deps,
      ctxWith(ALL_DMS.filter((p) => p !== 'dms.manage')),
      { id: doc.value.id },
    );
    expect(denied.ok).toBe(false);
  });

  it('sagt den anderen Modulen, dass das Dokument weg ist', async () => {
    const { deps, ctx } = setupWithProbe();
    const doc = await receiveDocument(deps, ctx, {
      filename: 'alt.pdf',
      bytes: pdfBytes(),
      typeKey: 'invoice',
      subject: 'Alt',
      documentDate: '2005-06-01',
    });
    if (!doc.ok) throw new Error('setup');
    deleted.length = 0;
    const result = await deleteDocument(deps, ctx, { id: doc.value.id });
    expect(result.ok).toBe(true);
    expect(deleted).toEqual([`document:${doc.value.id}`]);
  });

  async function expiredDocument(deps: Deps, ctx: CallContext, subject: string) {
    const doc = await receiveDocument(deps, ctx, {
      filename: 'alt.pdf',
      bytes: pdfBytes(),
      typeKey: 'invoice',
      subject,
      documentDate: '2005-06-01',
    });
    if (!doc.ok) throw new Error('setup: expiredDocument');
    return doc.value;
  }

  it('lehnt ab, solange ein Modul das Dokument hält — auch wenn die Frist der Art abgelaufen ist', async () => {
    const { deps, ctx } = setupWithProbe();
    const doc = await expiredDocument(deps, ctx, 'gehalten');
    expect(code(await deleteDocument(deps, ctx, { id: doc.id }))).toBe('recordHeld');
  });

  it('lehnt ab, solange ein Modul darauf zeigt', async () => {
    const { deps, ctx } = setupWithProbe();
    const doc = await expiredDocument(deps, ctx, 'verwiesen');
    expect(code(await deleteDocument(deps, ctx, { id: doc.id }))).toBe('stillReferenced');
  });

  it('eine offene Wiedervorlage hindert das Löschen weiterhin nicht — sie geht mit', async () => {
    const { deps, ctx, userId } = setupWithProbe();
    const doc = await expiredDocument(deps, ctx, 'frei');
    const followUpCtx = ctxWith([...ALL_DMS, 'followUps.manage', 'dms.create'], userId);
    unwrap(await createDocumentFollowUp(deps, followUpCtx, { documentId: doc.id, dueAt: '2040-01-01', title: 'Nachfassen' }));
    expect(code(await deleteDocument(deps, ctx, { id: doc.id }))).toBe('ok');
  });
});
