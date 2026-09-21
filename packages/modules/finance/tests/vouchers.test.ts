import { newId, schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documentLinks, documents, documentTypes, readLinkedDocument } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { attachDocument, uploadVoucher } from '../src/ledger/vouchers';
import { financeEntryDocuments, financePeriodEvents } from '../src/schema';
import { ledgerFixture, pdfBytes } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const now = '2026-03-01T10:00:00.000Z';

/** Ein festgeschriebenes Dokument der Art `letter` (ohne Bereich), direkt eingefügt — wie in `entry-documents-immutability.test.ts`. */
function seedLetter(deps: Awaited<ReturnType<typeof ledgerFixture>>['deps'], id: string, opts: { status?: 'issued' | 'voided'; phase?: 'draft' | 'issued' } = {}) {
  if (!deps.db.select({ key: documentTypes.key }).from(documentTypes).where(eq(documentTypes.key, 'letter')).get()) {
    deps.db.insert(documentTypes).values({ key: 'letter', label: 'Brief', prefix: 'BRF', defaultDirection: 'outgoing', retentionClass: 'statutory6Y', defaultFolder: null, isActive: true, sortOrder: 0, ownerModule: null, protectionArea: null }).run();
  }
  deps.db
    .insert(documents)
    .values({
      id, phase: opts.phase ?? 'issued', direction: 'outgoing', sourceKind: 'uploaded', typeKey: 'letter',
      number: opts.phase === 'draft' ? null : `BRF-2026-${id}`, subject: 'Brief', documentDate: '2026-03-01', folder: null,
      draftBody: opts.phase === 'draft' ? 'x' : null, fileName: opts.phase === 'draft' ? null : 'x', fileChecksum: opts.phase === 'draft' ? null : 'abc', fileBytes: opts.phase === 'draft' ? null : 1,
      textStatus: opts.phase === 'draft' ? null : 'unavailable', textAttempts: 0, textError: null, textExtractedAt: null,
      status: opts.status ?? 'issued', voidedAt: opts.status === 'voided' ? now : null, voidedByUserId: opts.status === 'voided' ? 'U1' : null, voidReason: opts.status === 'voided' ? 'Widerrufen' : null,
      createdByUserId: 'U1', createdAt: now, updatedAt: now,
    })
    .run();
}

describe('vouchers', () => {
  it('files a voucher in the name of the entry — the bookkeeper needs no right in the file module', async () => {
    const f = await ledgerFixture();
    const bookkeeper = ctxWith(['finance.entriesWrite', 'finance.read'], f.userId); // kein dms.*
    const entry = await f.finalEntry();
    const res = unwrap(await uploadVoucher(f.deps, bookkeeper, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-invoice', documentDate: '2026-03-01' }));
    expect(res.documentNumber).toMatch(/^ERE-/);
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, res.documentId)).get()!;
    expect(doc).toMatchObject({ phase: 'issued', typeKey: 'voucher-invoice', subject: 'Beleg vom 2026-03-01' });
    // der Beweis für die Akte
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, res.documentId), eq(documentLinks.entityType, 'financeEntry'), eq(documentLinks.entityId, entry.id))).all()).toHaveLength(1);
    // … und damit liest der Kassenprüfer genau diesen Beleg, ohne dms.view
    expect((await readLinkedDocument(f.deps, ctxWith(['finance.read']), { documentId: res.documentId, entityType: 'financeEntry', entityId: entry.id })).ok).toBe(true);
  });

  it('the document type must be one the association treats as a finance voucher', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalEntry();
    expect(err(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'letter', documentDate: '2026-03-01' }))).toMatchObject({ type: 'conflict', code: 'voucherTypeNotAllowed' });
  });

  it('is possible on a finalized entry and in a closed year — handing in a voucher is always allowed', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalEntry();
    f.deps.db.insert(financePeriodEvents).values({ id: newId(), fiscalYearId: entry.fiscalYearId!, kind: 'closed', at: '2026-04-01T00:00:00.000Z', byUserId: f.userId, reason: null }).run();
    const res = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-receipt', documentDate: '2026-03-01' }));
    expect(res.documentNumber).toMatch(/^QTG-/);
  });

  it('needs finance.entriesWrite', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalEntry();
    const reader = ctxWith(['finance.read'], f.userId);
    expect(err(await uploadVoucher(f.deps, reader, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-invoice', documentDate: '2026-03-01' }))).toEqual({ type: 'forbidden', permission: 'finance.entriesWrite' });
    seedLetter(f.deps, 'DOC-A');
    expect(err(await attachDocument(f.deps, reader, { entryId: entry.id, documentId: 'DOC-A' }))).toEqual({ type: 'forbidden', permission: 'finance.entriesWrite' });
  });

  it('takes no photo: the file module accepts PDF only', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalEntry();
    const notAPdf = new TextEncoder().encode('Das ist kein PDF');
    expect(err(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: notAPdf, typeKey: 'voucher-invoice', documentDate: '2026-03-01' }))).toMatchObject({ type: 'validation' });
    expect(f.deps.db.select().from(financeEntryDocuments).all()).toHaveLength(0);
    expect(f.deps.db.select().from(documents).all()).toHaveLength(0);
  });

  it('leaves nothing behind when the entry does not exist', async () => {
    const f = await ledgerFixture();
    expect(err(await uploadVoucher(f.deps, f.ctx, { entryId: 'nope', bytes: pdfBytes(), typeKey: 'voucher-invoice', documentDate: '2026-03-01' }))).toMatchObject({ type: 'notFound', entity: 'financeEntry' });
    expect(f.deps.db.select().from(documents).all()).toHaveLength(0);
  });

  it('links a document from the file — only one the caller may read, filed, not voided', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalEntry();
    seedLetter(f.deps, 'DOC1');
    const withDms = ctxWith([...f.ctx.permissions, 'dms.view'], f.userId);

    // ohne dms.view → forbidden('dms.view')
    expect(err(await attachDocument(f.deps, f.ctx, { entryId: entry.id, documentId: 'DOC1' }))).toEqual({ type: 'forbidden', permission: 'dms.view' });

    const linked = unwrap(await attachDocument(f.deps, withDms, { entryId: entry.id, documentId: 'DOC1' }));
    expect(linked).toMatchObject({ documentId: 'DOC1', documentNumber: 'BRF-2026-DOC1' });
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, 'DOC1'), eq(documentLinks.entityType, 'financeEntry'), eq(documentLinks.entityId, entry.id))).all()).toHaveLength(1);

    // ein Entwurf → documentNotFinal
    seedLetter(f.deps, 'DOC2', { phase: 'draft' });
    expect(err(await attachDocument(f.deps, withDms, { entryId: entry.id, documentId: 'DOC2' }))).toMatchObject({ type: 'conflict', code: 'documentNotFinal' });

    // ein storniertes → documentVoided
    seedLetter(f.deps, 'DOC3', { status: 'voided' });
    expect(err(await attachDocument(f.deps, withDms, { entryId: entry.id, documentId: 'DOC3' }))).toMatchObject({ type: 'conflict', code: 'documentVoided' });

    // zweimal dasselbe → voucherAlreadyLinked
    expect(err(await attachDocument(f.deps, withDms, { entryId: entry.id, documentId: 'DOC1' }))).toMatchObject({ type: 'conflict', code: 'voucherAlreadyLinked' });
  });

  it('logs ids and counts, never the title', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalEntry();
    const res = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-invoice', title: 'Rechnung von Erika Beispiel', documentDate: '2026-03-01' }));
    const log = JSON.stringify(f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action.startsWith('finance.entry.document')));
    expect(log).toContain('finance.entry.documentAdd');
    expect(log).toContain(entry.id);
    expect(log).toContain(res.documentId);
    expect(log).not.toContain('Erika');
    expect(log).not.toContain('Rechnung von');
  });
});
