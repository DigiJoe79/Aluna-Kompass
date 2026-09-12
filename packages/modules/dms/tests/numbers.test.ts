import { describe, expect, it } from 'vitest';
import { createDraft, fileDocument } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { documentCounters } from '../src/schema';
import { allocateDocumentNumber, deleteDocument, peekDocumentNumber } from '../src/service';
import { pdfBytes, setupWithTypes } from './helpers';

describe('Nummern', () => {
  it('zieht aus dem Zähler, und Ansehen zieht nicht', () => {
    const { deps } = setupWithTypes();
    expect(peekDocumentNumber(deps.db, 'BRF', 2026)).toBe('BRF-2026-001');
    expect(peekDocumentNumber(deps.db, 'BRF', 2026)).toBe('BRF-2026-001');
    const first = deps.db.transaction((tx) => allocateDocumentNumber(tx, 'BRF', 2026));
    const second = deps.db.transaction((tx) => allocateDocumentNumber(tx, 'BRF', 2026));
    expect([first, second]).toEqual(['BRF-2026-001', 'BRF-2026-002']);
    expect(peekDocumentNumber(deps.db, 'BRF', 2026)).toBe('BRF-2026-003');
    expect(deps.db.select().from(documentCounters).all()).toEqual([{ prefix: 'BRF', year: 2026, last: 2 }]);
  });

  it('vergibt eine gelöschte Nummer nie wieder', async () => {
    const { deps, ctx } = setupWithTypes();
    deps.clock.set('2040-03-01T10:00:00.000Z');
    const received = await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'alt', documentDate: '2026-01-15' });
    if (!received.ok) throw new Error('receive');
    expect(received.value.number).toBe('RCH-2040-001');

    // Frist der Rechnung (10 Jahre ab Ende 2026) ist 2040 abgelaufen.
    const deleted = await deleteDocument(deps, ctx, { id: received.value.id });
    expect(deleted.ok).toBe(true);

    const next = await receiveDocument(deps, ctx, { filename: 'b.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'neu', documentDate: '2040-02-01' });
    expect(next.ok && next.value.number).toBe('RCH-2040-002');
  });

  it('ein festgeschriebener Entwurf trägt die Nummer aus dem Zähler', async () => {
    const { deps, ctx } = setupWithTypes();
    const a = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'a', body: 'x' });
    const b = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'b', body: 'x' });
    if (!a.ok || !b.ok) throw new Error('draft');
    const fa = await fileDocument(deps, ctx, { id: a.value.id });
    const fb = await fileDocument(deps, ctx, { id: b.value.id });
    expect([fa.ok && fa.value.number, fb.ok && fb.value.number]).toEqual(['BRF-2026-001', 'BRF-2026-002']);
  });
});
