import { unwrap, type CallContext, type Deps, type Result } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createDocumentFolder, createDocumentRule, createDocumentType, deleteDocumentType, listDocumentTypes, moveDocumentFolder } from '../src/catalog';
import { suggestClassification } from '../src/classification';
import { createDraft, deleteDraft, fileDocument } from '../src/drafts';
import { receiveDocument, reclassifyDocument } from '../src/incoming';
import { deleteDocument, getDocument, listDocuments, previewNextNumber, voidDocument } from '../src/service';
import { extractDocumentText } from '../src/text';
import { ALL_DMS, fileFixture, pdfBytes, setupWithTypes } from './helpers';

/**
 * Das Pflichtminimum je Dienst: Wem genau das eine Recht fehlt, der bekommt `forbidden` mit diesem Recht —
 * nicht irgendeinen Fehler. Jeder Fall nimmt dem Aufrufer nur das erwartete Recht weg, alle anderen behält er.
 * Bereichsrechte prüft `areas-write.test.ts`.
 */
async function fixture() {
  const { deps, ctx } = setupWithTypes();
  const draft = unwrap(await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Entwurf', body: 'x' }));
  const received = unwrap(await receiveDocument(deps, ctx, { filename: 'alt.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'Alt', documentDate: '2005-06-01' }));
  const filed = await fileFixture(deps, ctx);
  unwrap(await createDocumentType(deps, ctx, { key: 'memo', label: 'Vermerk', prefix: 'VMK', defaultDirection: 'outgoing', retentionClass: 'statutory6Y' }));
  unwrap(await createDocumentFolder(deps, ctx, { path: 'behoerden' }));
  return { deps, draftId: draft.id, receivedId: received.id, filedId: filed.id };
}

type Fixture = Awaited<ReturnType<typeof fixture>> & { deps: Deps };
type Call = (f: Fixture, ctx: CallContext) => Promise<Result<unknown>>;

const CASES: [service: string, permission: string, call: Call][] = [
  ['listDocuments', 'dms.view', (f, c) => listDocuments(f.deps, c, {})],
  ['getDocument', 'dms.view', (f, c) => getDocument(f.deps, c, f.filedId)],
  ['previewNextNumber', 'dms.view', (f, c) => previewNextNumber(f.deps, c, { typeKey: 'authority' })],
  ['listDocumentTypes', 'dms.view', (f, c) => listDocumentTypes(f.deps, c, {})],
  ['suggestClassification', 'dms.view', (f, c) => suggestClassification(f.deps, c, { filename: 'x.pdf' })],
  ['createDraft', 'dms.create', (f, c) => createDraft(f.deps, c, { typeKey: 'letter', subject: 'x', body: 'y' })],
  ['receiveDocument', 'dms.create', (f, c) => receiveDocument(f.deps, c, { filename: 'x.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'X', documentDate: '2026-03-14' })],
  ['reclassifyDocument', 'dms.create', (f, c) => reclassifyDocument(f.deps, c, { id: f.receivedId, subject: 'X' })],
  ['fileDocument', 'dms.file', (f, c) => fileDocument(f.deps, c, { id: f.draftId })],
  ['voidDocument', 'dms.void', (f, c) => voidDocument(f.deps, c, { id: f.filedId, reason: 'x' })],
  ['deleteDraft', 'dms.deleteDraft', (f, c) => deleteDraft(f.deps, c, { id: f.draftId })],
  ['deleteDocument', 'dms.manage', (f, c) => deleteDocument(f.deps, c, { id: f.receivedId })],
  ['deleteDocumentType', 'dms.manage', (f, c) => deleteDocumentType(f.deps, c, { key: 'memo' })],
  ['createDocumentRule', 'dms.manage', (f, c) => createDocumentRule(f.deps, c, { matchField: 'filename', matchContains: 'Finanzamt', thenTypeKey: 'authority' })],
  ['createDocumentFolder', 'dms.manage', (f, c) => createDocumentFolder(f.deps, c, { path: 'x' })],
  ['moveDocumentFolder', 'dms.manage', (f, c) => moveDocumentFolder(f.deps, c, { from: 'behoerden', to: 'archiv' })],
  ['extractDocumentText', 'dms.manage', (f, c) => extractDocumentText(f.deps, c, { documentId: f.receivedId })],
];

describe('Rechte je Dienst', () => {
  it.each(CASES)('%s verlangt %s', async (_service, permission, call) => {
    const f = await fixture();
    const result = await call(f, ctxWith(ALL_DMS.filter((p) => p !== permission)));
    expect(result.ok ? 'ok' : result.error).toEqual({ type: 'forbidden', permission });
  });
});
