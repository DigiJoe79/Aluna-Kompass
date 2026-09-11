import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { receiveDocument } from '../src/incoming';
import { documentLinks, documents } from '../src/schema';
import { deleteDocument } from '../src/service';
import { ALL_DMS, auditActions, pdfBytes, setupWithTypes } from './helpers';

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
});
