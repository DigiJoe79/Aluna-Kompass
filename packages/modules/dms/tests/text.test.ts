import { coreModule, fakeTextExtraction, queryAudit, systemContext, type Deps, type TextExtraction } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { receiveDocument } from '../src/incoming';
import { countDocumentText } from '../src/index-store';
import { dmsModule } from '../src/manifest';
import { documents } from '../src/schema';
import { deleteDocument } from '../src/service';
import { extractDocumentText, reindexAllDocuments } from '../src/text';
import { seedTypes } from './helpers';

const pdf = () => new Uint8Array(Buffer.from('%PDF-1.4\n%fake\n', 'latin1'));

/** Werkzeuge da, aber das Lesen scheitert — ein zerschossenes PDF. */
const brokenExtraction = (): TextExtraction => ({
  probe: async () => ({ ok: true, languages: ['deu'] }),
  extract: async () => {
    throw new Error('Seite 1 liess sich nicht lesen');
  },
});

function auditFor(deps: Deps, action: string) {
  const entries = queryAudit(deps, ctxWith(['audit.view']), { entityType: 'document' });
  if (!entries.ok) throw new Error('Protokoll nicht lesbar');
  return entries.value.entries.filter((e) => e.action === action);
}

async function withDocument(textExtraction = fakeTextExtraction(), documentDate = '2026-09-11') {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule], textExtraction });
  insertUser(deps, { id: 'USER-TEST' });
  await seedTypes(deps);
  const received = await receiveDocument(deps, ctxWith(['dms.create']), {
    filename: 'post.pdf',
    typeKey: 'letter',
    subject: 'Eingang',
    documentDate,
    bytes: pdf(),
  });
  if (!received.ok) throw new Error('Aufbau fehlgeschlagen');
  return { deps, documentId: received.value.id };
}

describe('extractDocumentText', () => {
  it('liest ein Dokument und setzt es auf done', async () => {
    const { deps, documentId } = await withDocument(
      fakeTextExtraction({
        pages: [
          { page: 1, text: 'Tierarztrechnung 2026-4711', source: 'layer' },
          { page: 2, text: 'Impfung und Kastration', source: 'ocr' },
        ],
      }),
    );

    const result = await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ pages: 2, status: 'done' });
  });

  it('reicht die eingestellten Sprachen an das Werkzeug durch', async () => {
    const seen: string[][] = [];
    const { deps, documentId } = await withDocument(
      fakeTextExtraction({ onExtract: (o) => seen.push(o.languages) }),
    );

    await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId });

    expect(seen).toEqual([['deu', 'eng']]);
  });

  it('meldet unavailable, wenn die Werkzeuge fehlen — ohne Versuche zu zählen', async () => {
    const { deps, documentId } = await withDocument(
      fakeTextExtraction({ probe: { ok: false, error: 'tesseract ist nicht installiert' } }),
    );

    const result = await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('unavailable');
  });

  it('zählt Versuche und bleibt beim dritten bei failed', async () => {
    const broken = {
      probe: async () => ({ ok: true as const, languages: ['deu'] }),
      extract: async () => {
        throw new Error('Seite 4 überschritt das Zeitlimit');
      },
    };
    const { deps, documentId } = await withDocument(broken);
    const ctx = ctxWith(['dms.manage']);

    for (let i = 0; i < 3; i += 1) await extractDocumentText(deps, ctx, { documentId });
    const fourth = await extractDocumentText(deps, ctx, { documentId });

    expect(fourth.ok).toBe(false);
    if (fourth.ok) return;
    expect(fourth.error.type).toBe('conflict');
  });

  it('verweigert ohne Recht', async () => {
    const { deps, documentId } = await withDocument();

    const result = await extractDocumentText(deps, ctxWith(['dms.view']), { documentId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('forbidden');
  });

  it('weist Unsinn als validation zurück', async () => {
    const { deps } = await withDocument();

    const result = await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('validation');
  });

  it('schreibt einen Eintrag je Dokument, nicht je Seite', async () => {
    const { deps, documentId } = await withDocument(
      fakeTextExtraction({
        pages: [
          { page: 1, text: 'eins', source: 'layer' },
          { page: 2, text: 'zwei', source: 'layer' },
          { page: 3, text: 'drei', source: 'layer' },
        ],
      }),
    );

    await extractDocumentText(deps, systemContext({ permissions: ['dms.manage'] }), { documentId });

    const entries = queryAudit(deps, ctxWith(['audit.view']), { entityType: 'document' });
    expect(entries.ok).toBe(true);
    if (!entries.ok) return;
    const read = entries.value.entries.filter((e) => e.action === 'document.textExtracted');
    expect(read).toHaveLength(1);
    expect(read[0]!.channel).toBe('system');
  });

  it('hält auch das Aufgeben im Protokoll fest', async () => {
    // Jede schreibende Aktion gehört ins Änderungsprotokoll (AGENTS.md). Ein
    // Dokument, das dreimal scheiterte und danach nie wieder gelesen wird, ist
    // kein Nichts — es ist der Grund, warum später etwas fehlt.
    const { deps, documentId } = await withDocument(brokenExtraction());
    const ctx = systemContext({ permissions: ['dms.manage'] });

    for (let i = 0; i < 3; i += 1) await extractDocumentText(deps, ctx, { documentId });

    const failed = auditFor(deps, 'document.textExtractionFailed');
    // Einer, beim Aufgeben — nicht bei jedem der drei Anläufe.
    expect(failed).toHaveLength(1);
    expect(failed[0]!.channel).toBe('system');
    expect(JSON.stringify(failed[0]!.after)).toContain('Seite 1');
  });

  it('hält fest, dass die Werkzeuge fehlten', async () => {
    const { deps, documentId } = await withDocument(
      fakeTextExtraction({ probe: { ok: false, error: 'tesseract ist nicht installiert' } }),
    );

    await extractDocumentText(deps, systemContext({ permissions: ['dms.manage'] }), { documentId });

    const entries = auditFor(deps, 'document.textExtractionUnavailable');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.channel).toBe('system');
  });

  it('legt die gelesenen Seiten in den Index', async () => {
    const { deps, documentId } = await withDocument(
      fakeTextExtraction({
        pages: [
          { page: 1, text: 'Tierarztrechnung 2026-4711', source: 'layer' },
          { page: 2, text: 'Impfung und Kastration', source: 'ocr' },
        ],
      }),
    );

    await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId });

    expect(countDocumentText(deps, documentId)).toBe(2);
  });

  it('ein zweiter Lauf verdoppelt nichts', async () => {
    const { deps, documentId } = await withDocument();
    const ctx = ctxWith(['dms.manage']);

    await extractDocumentText(deps, ctx, { documentId });
    // Nach dem ersten Lauf steht `done`; fuer den zweiten wieder freigeben.
    deps.db.update(documents).set({ textStatus: 'pending' }).where(eq(documents.id, documentId)).run();
    await extractDocumentText(deps, ctx, { documentId });

    expect(countDocumentText(deps, documentId)).toBe(1);
  });

  it('ein gelöschtes Dokument verschwindet aus dem Index', async () => {
    const { deps, documentId } = await withDocument(fakeTextExtraction(), '2005-06-01');
    await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId });

    const deleted = await deleteDocument(deps, ctxWith(['dms.manage']), { id: documentId });
    expect(deleted.ok).toBe(true);

    expect(countDocumentText(deps, documentId)).toBe(0);
  });

  it('stellt alle Dokumente mit Datei wieder in die Schlange', async () => {
    const { deps, documentId } = await withDocument();
    await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId });

    const result = await reindexAllDocuments(deps, ctxWith(['dms.manage']));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.queued).toBe(1);
    const row = deps.db.select().from(documents).where(eq(documents.id, documentId)).get();
    expect(row?.textStatus).toBe('pending');
    expect(row?.textAttempts).toBe(0);
  });

  it('verweigert das Neu-Lesen ohne dms.manage', async () => {
    const { deps } = await withDocument();

    const result = await reindexAllDocuments(deps, ctxWith(['dms.view']));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('forbidden');
  });
});
