import { unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createDocumentRule, listDocumentTypes, updateDocumentType } from '../src/catalog';
import { createDraft } from '../src/drafts';
import { receiveDocument, reclassifyDocument } from '../src/incoming';
import { ensureDocumentType } from '../src/provision';
import { previewNextNumber } from '../src/service';
import { pdfBytes, setupWithTypes } from './helpers';

const code = (r: { ok: boolean; error?: { type: string; code?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

function setup() {
  const s = setupWithTypes();
  s.deps.db.transaction((tx) => ensureDocumentType(tx, s.deps, systemContext(), { module: 'probe', key: 'probe-note', label: 'Notiz', prefix: 'NTZ', defaultDirection: 'incoming', retentionClass: 'statutory10Y', owned: true }));
  return s;
}

describe('a module-owned document type', () => {
  it('takes no free draft, no free incoming document, no number preview', async () => {
    const { deps, ctx } = setup();
    expect(code(await createDraft(deps, ctx, { typeKey: 'probe-note', subject: 'x', body: '' }))).toBe('documentTypeOwnedByModule');
    expect(code(await receiveDocument(deps, ctx, { filename: 'a.pdf', typeKey: 'probe-note', subject: 'x', documentDate: '2026-09-01', bytes: pdfBytes() }))).toBe('documentTypeOwnedByModule');
    expect(code(await previewNextNumber(deps, ctx, { typeKey: 'probe-note' }))).toBe('documentTypeOwnedByModule');
  });

  it('is no target for reclassifying and none for a filing rule', async () => {
    const { deps, ctx } = setup();
    const doc = unwrap(await receiveDocument(deps, ctx, { filename: 'a.pdf', typeKey: 'contract', subject: 'x', documentDate: '2026-09-01', bytes: pdfBytes() }));
    expect(code(await reclassifyDocument(deps, ctx, { id: doc.id, typeKey: 'probe-note', expectedVersion: doc.updatedAt }))).toBe('documentTypeOwnedByModule');
    expect(code(await createDocumentRule(deps, ctx, { matchField: 'filename', matchContains: 'notiz', thenTypeKey: 'probe-note' }))).toBe('documentTypeOwnedByModule');
  });

  it('lets the association rename it and nothing else', async () => {
    const { deps, ctx } = setup();
    expect(unwrap(await updateDocumentType(deps, ctx, { key: 'probe-note', label: 'Aktennotiz' })).label).toBe('Aktennotiz');
    for (const change of [{ retentionClass: 'consent' as const }, { isActive: false }, { defaultDirection: 'outgoing' as const }, { prefix: 'NTX' }]) {
      expect(code(await updateDocumentType(deps, ctx, { key: 'probe-note', ...change }))).toBe('documentTypeOwnedByModule');
    }
  });

  it('is not offered where a person chooses a type', async () => {
    const { deps, ctx } = setup();
    const keys = unwrap(await listDocumentTypes(deps, ctx, { selectable: true })).map((t) => t.key);
    expect(keys).not.toContain('probe-note');
    expect(unwrap(await listDocumentTypes(deps, ctx, {})).map((t) => t.key)).toContain('probe-note');
  });
});
