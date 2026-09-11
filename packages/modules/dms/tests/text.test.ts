import { coreModule, fakeTextExtraction, queryAudit, systemContext } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { receiveDocument } from '../src/incoming';
import { dmsModule } from '../src/manifest';
import { extractDocumentText } from '../src/text';
import { seedTypes } from './helpers';

const pdf = () => new Uint8Array(Buffer.from('%PDF-1.4\n%fake\n', 'latin1'));

async function withDocument(textExtraction = fakeTextExtraction()) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule], textExtraction });
  insertUser(deps, { id: 'USER-TEST' });
  await seedTypes(deps);
  const received = await receiveDocument(deps, ctxWith(['dms.create']), {
    filename: 'post.pdf',
    typeKey: 'letter',
    subject: 'Eingang',
    documentDate: '2026-09-11',
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
});
