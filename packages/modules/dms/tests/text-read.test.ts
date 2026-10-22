import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { createDraft } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { replaceDocumentText } from '../src/index-store';
import { getDocumentText, getDocumentTextStatus } from '../src/text';
import { fileFixture, pdfBytes, setupWithTypes } from './helpers';

/** Der Anfangszustand der Texterkennung — hier und nur hier. */
describe('Erkennungszustand am Dokument', () => {
  it('eingegangene Post wartet auf Erkennung, ein Entwurf ohne Datei auf nichts', async () => {
    const { deps, ctx } = setupWithTypes();
    const received = unwrap(await receiveDocument(deps, ctx, { filename: 'post.pdf', typeKey: 'letter', subject: 'Eingang', documentDate: '2026-09-11', bytes: pdfBytes() }));
    expect(received).toMatchObject({ textStatus: 'pending', textAttempts: 0, textError: null, textExtractedAt: null });
    const draft = unwrap(await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Entwurf', body: 'Text' }));
    expect(draft.textStatus).toBeNull();
  });
});

describe('getDocumentText', () => {
  it('liefert die Seiten aus dem Index, sobald gelesen wurde', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    replaceDocumentText(deps, letter.id, [{ page: 1, text: 'Seite eins' }, { page: 2, text: 'Seite zwei' }]);
    deps.sqlite.prepare(`update documents set text_status = 'done' where id = ?`).run(letter.id);
    const res = await getDocumentText(deps, ctx, { documentId: letter.id });
    expect(res.ok && res.value).toEqual({ textStatus: 'done', textError: null, pages: [{ page: 1, text: 'Seite eins' }, { page: 2, text: 'Seite zwei' }] });
  });

  it('sagt, warum nichts da ist, statt leer zu schweigen', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const res = await getDocumentText(deps, ctx, { documentId: letter.id });
    expect(res.ok && res.value.textStatus).toBe('pending');
    expect(res.ok && res.value.pages).toEqual([]);
    const { ctx: nobody } = setupWithTypes([]);
    expect((await getDocumentText(deps, nobody, { documentId: letter.id })).ok).toBe(false);
    const ghost = await getDocumentText(deps, ctx, { documentId: 'NOPE' });
    expect(!ghost.ok && ghost.error.type).toBe('notFound');
  });
});

describe('getDocumentTextStatus', () => {
  it('liefert nur den Stand, und nur wem das Dokument lesbar ist', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const res = await getDocumentTextStatus(deps, ctx, letter.id);
    expect(res.ok && res.value).toEqual({ textStatus: 'pending' });
    const { ctx: nobody } = setupWithTypes([]);
    expect((await getDocumentTextStatus(deps, nobody, letter.id)).ok).toBe(false);
    const ghost = await getDocumentTextStatus(deps, ctx, 'NOPE');
    expect(!ghost.ok && ghost.error.type).toBe('notFound');
  });
});
