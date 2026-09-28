import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { receiveDocument } from '../src/incoming';
import { receiveGeneratedUpload } from '../src/linked';
import { getDocumentRecord, voidDocument } from '../src/service';
import { ALL_DMS, pdfBytes, setupWithArea, setupWithProbe, setupWithTypes } from './helpers';

/** Befund Z (Prüfer Block 3): dieselbe Datei zweimal abgelegt — ein Hinweis, kein Verbot. */
const other = () => new TextEncoder().encode('%PDF-1.4\n% anders\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const input = { typeKey: 'authority', subject: 'Rechnung', documentDate: '2026-03-14' } as const;

describe('inhaltsgleiche Dokumente', () => {
  it('meldet beim Ablegen, als welche Nummer dieselbe Datei schon vorliegt, und legt trotzdem ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const first = unwrap(await receiveDocument(deps, ctx, { ...input, filename: 'a.pdf', bytes: pdfBytes() }));
    expect(first.duplicateOf).toEqual([]);
    const second = unwrap(await receiveDocument(deps, ctx, { ...input, filename: 'b.pdf', bytes: pdfBytes() }));
    expect(second.duplicateOf).toEqual([{ id: first.id, number: first.number }]);
    expect(second.id).not.toBe(first.id);
    const third = unwrap(await receiveDocument(deps, ctx, { ...input, filename: 'c.pdf', bytes: other() }));
    expect(third.duplicateOf).toEqual([]);
  });

  it('nennt ein storniertes Dokument nicht', async () => {
    const { deps, ctx } = setupWithTypes();
    const first = unwrap(await receiveDocument(deps, ctx, { ...input, filename: 'a.pdf', bytes: pdfBytes() }));
    unwrap(await voidDocument(deps, ctx, { id: first.id, reason: 'doppelt' }));
    expect(unwrap(await receiveDocument(deps, ctx, { ...input, filename: 'b.pdf', bytes: pdfBytes() })).duplicateOf).toEqual([]);
  });

  it('verrät kein Dokument, das der Aufrufer nicht lesen darf', async () => {
    const f = await setupWithArea();
    // `secretId` liegt mit `pdfBytes()` in einer geschützten Art; `viewer` hat die Akte ohne das Bereichsrecht.
    expect(unwrap(await receiveDocument(f.deps, f.viewer, { ...input, filename: 'x.pdf', bytes: pdfBytes() })).duplicateOf.map((d) => d.id)).not.toContain(f.secretId);
    const seen = unwrap(await receiveDocument(f.deps, f.all, { ...input, filename: 'y.pdf', bytes: pdfBytes() }));
    expect(seen.duplicateOf.map((d) => d.id)).toContain(f.secretId);
  });

  it('zeigt die Doppel eines Dokuments in beide Richtungen am einzelnen Dokument', async () => {
    const { deps, ctx } = setupWithTypes();
    const first = unwrap(await receiveDocument(deps, ctx, { ...input, filename: 'a.pdf', bytes: pdfBytes() }));
    const second = unwrap(await receiveDocument(deps, ctx, { ...input, filename: 'b.pdf', bytes: pdfBytes() }));
    expect(unwrap(await getDocumentRecord(deps, ctx, first.id)).duplicateOf).toEqual([{ id: second.id, number: second.number }]);
    expect(unwrap(await getDocumentRecord(deps, ctx, second.id)).duplicateOf).toEqual([{ id: first.id, number: first.number }]);
  });

  it('meldet das Doppel auch beim Ablegen im Namen eines Vorgangs', async () => {
    const { deps, ctx } = setupWithProbe([...ALL_DMS, 'probe.read', 'probe.issue']);
    const first = unwrap(await receiveDocument(deps, ctx, { ...input, filename: 'a.pdf', bytes: pdfBytes() }));
    const upload = unwrap(await receiveGeneratedUpload(deps, ctx, { bytes: pdfBytes(), typeKey: 'authority', subject: 'Beleg', documentDate: '2026-03-14', links: [{ entityType: 'probeThing', entityId: 'P1' }] }));
    expect(upload.document.duplicateOf).toEqual([{ id: first.id, number: first.number }]);
  });
});
