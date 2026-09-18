import { describe, expect, it } from 'vitest';
import { createDocumentFolder } from '../src/catalog';
import { createDraft, updateDraft } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { deleteDocument, voidDocument } from '../src/service';
import { pdfBytes, setupWithTypes } from './helpers';

describe('Storno und Fristlöschung nur für Festgeschriebenes', () => {
  it('ein Entwurf lässt sich nicht stornieren', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y' });
    if (!draft.ok) throw new Error('draft');
    const voided = await voidDocument(deps, ctx, { id: draft.value.id, reason: 'egal' });
    expect(!voided.ok && voided.error.type === 'conflict' && voided.error.code).toBe('documentIsDraft');
  });

  it('die Fristlöschung greift keinen Entwurf an, auch nicht mit altem Datum', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y', documentDate: '2001-01-01' });
    if (!draft.ok) throw new Error('draft');
    const deleted = await deleteDocument(deps, ctx, { id: draft.value.id });
    expect(!deleted.ok && deleted.error.type === 'conflict' && deleted.error.code).toBe('documentIsDraft');
  });
});

describe('Ordner werden geprüft', () => {
  it('Ablegen in einen unbekannten Ordner ist notFound', async () => {
    const { deps, ctx } = setupWithTypes();
    const res = await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 's', documentDate: '2026-09-01', folder: 'gibt/es/nicht' });
    expect(!res.ok && res.error.type === 'notFound' && res.error.entity).toBe('documentFolder');
  });

  it('Ablegen in einen bekannten Ordner normalisiert den Pfad', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDocumentFolder(deps, ctx, { path: 'behoerden' });
    const res = await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 's', documentDate: '2026-09-01', folder: '/behoerden/' });
    expect(res.ok && res.value.folder).toBe('behoerden');
  });

  it('Entwurf anlegen und ändern prüfen den Ordner ebenso', async () => {
    const { deps, ctx } = setupWithTypes();
    const bad = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y', folder: 'nirgends' });
    expect(!bad.ok && bad.error.type).toBe('notFound');
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y' });
    if (!draft.ok) throw new Error('draft');
    const moved = await updateDraft(deps, ctx, { id: draft.value.id, folder: 'nirgends' });
    expect(!moved.ok && moved.error.type).toBe('notFound');
  });
});
