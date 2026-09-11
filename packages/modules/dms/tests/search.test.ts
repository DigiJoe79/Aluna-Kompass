import { coreModule, fakeTextExtraction } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { receiveDocument } from '../src/incoming';
import { dmsModule } from '../src/manifest';
import { matchExpression, SNIPPET_MARK_START } from '../src/search';
import { listDocuments } from '../src/service';
import { extractDocumentText } from '../src/text';
import { seedTypes } from './helpers';

const pdf = () => new Uint8Array(Buffer.from('%PDF-1.4\n%fake\n', 'latin1'));

async function withRead(text: string, subject = 'Ohne sprechenden Betreff') {
  const deps = createTestDeps({
    manifests: [coreModule, contactsModule, dmsModule],
    textExtraction: fakeTextExtraction({ pages: [{ page: 1, text, source: 'layer' }] }),
  });
  insertUser(deps, { id: 'USER-TEST' });
  await seedTypes(deps);
  const received = await receiveDocument(deps, ctxWith(['dms.create']), {
    filename: 'post.pdf',
    typeKey: 'letter',
    subject,
    documentDate: '2026-09-11',
    bytes: pdf(),
  });
  if (!received.ok) throw new Error('Aufbau fehlgeschlagen');
  await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId: received.value.id });
  return { deps, documentId: received.value.id };
}

describe('Suche', () => {
  it('findet ein Wort, das nur im Volltext steht', async () => {
    const { deps, documentId } = await withRead('Tierarztrechnung für die Kätzin Bärbel');

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'rechnung' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documents.map((d) => d.id)).toEqual([documentId]);
  });

  it('findet weiterhin über den Betreff', async () => {
    const { deps, documentId } = await withRead('Irgendein Inhalt', 'Kündigung Mietvertrag');

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'Mietvertrag' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documents.map((d) => d.id)).toEqual([documentId]);
  });

  it('zählt Volltexttreffer in total mit', async () => {
    const { deps } = await withRead('Tierarztrechnung');

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'rechnung', limit: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(1);
  });

  it('sagt es, wenn der Begriff zu kurz für den Volltext ist', async () => {
    const { deps } = await withRead('Tierarztrechnung');

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'ab' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fulltextTooShort).toBe(true);
    expect(result.value.documents).toEqual([]);
  });

  it('behandelt Anführungszeichen in der Eingabe als Text, nicht als Syntax', async () => {
    const { deps } = await withRead('Tierarztrechnung');

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'rech"nung' });

    // Darf nicht werfen und nicht die halbe Tabelle liefern.
    expect(result.ok).toBe(true);
  });

  it('liefert Passage und Seitenzahl zum Treffer', async () => {
    const { deps, documentId } = await withRead('Tierarztrechnung vom 14. Oktober 2026 für die Kätzin Bärbel');

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'rechnung' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hit = result.value.hits[documentId];
    expect(hit?.page).toBe(1);
    expect(hit?.snippet).toContain('Oktober');
    // Die Markierung ist da, und zwar als Steuerzeichen — nicht als Markup.
    expect(hit?.snippet).toContain(SNIPPET_MARK_START);
    expect(hit?.snippet).not.toContain('<');
  });

  it('nennt die Seite, auf der es steht — nicht immer die erste', async () => {
    const deps = createTestDeps({
      manifests: [coreModule, contactsModule, dmsModule],
      textExtraction: fakeTextExtraction({
        pages: [
          { page: 1, text: 'Deckblatt ohne den gesuchten Begriff, nur Anschrift und Betreffzeile.', source: 'layer' },
          { page: 2, text: 'Hier steht die Tierarztrechnung mit allen Positionen.', source: 'ocr' },
        ],
      }),
    });
    insertUser(deps, { id: 'USER-TEST' });
    await seedTypes(deps);
    const received = await receiveDocument(deps, ctxWith(['dms.create']), {
      filename: 'post.pdf',
      typeKey: 'letter',
      subject: 'Ohne sprechenden Betreff',
      documentDate: '2026-09-11',
      bytes: pdf(),
    });
    if (!received.ok) throw new Error('Aufbau fehlgeschlagen');
    await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId: received.value.id });

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'rechnung' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hits[received.value.id]?.page).toBe(2);
  });

  it('hat keine Passage, wenn der Treffer aus dem Betreff kam', async () => {
    const { deps, documentId } = await withRead('Irgendein Inhalt', 'Kündigung Mietvertrag');

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'Mietvertrag' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hits[documentId]).toBeUndefined();
  });
});

describe('matchExpression', () => {
  it('macht aus zwei Wörtern eine UND-Verknüpfung von Phrasen', () => {
    expect(matchExpression('praxis sommer')).toBe('"praxis" AND "sommer"');
  });

  it('wirft zu kurze Bestandteile weg', () => {
    expect(matchExpression('dr sommer')).toBe('"sommer"');
  });

  it('gibt null, wenn nichts übrig bleibt', () => {
    expect(matchExpression('dr. x')).toBeNull();
  });

  it('entschärft Anführungszeichen', () => {
    expect(matchExpression('rech"nung')).toBe('"rech""nung"');
  });
});
