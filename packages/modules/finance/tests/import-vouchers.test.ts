import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveImportRule } from '../src/import/rules';
import { attachVoucherToTransaction, searchVouchersForTransaction } from '../src/import/vouchers';
import { getEntry, saveDraft } from '../src/ledger/entries';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeEntries, financeEntryDocuments } from '../src/schema';
import { insertDocument, insertRaw, insertRun, ledgerFixture, pdfBytes } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

/** Wer in der Akte sucht, braucht die Leserechte der Akte — die Belegarten tragen keinen eigenen Bereich. */
const reader = (f: Fixture) => ctxWith([...FINANCE_PERMISSIONS, 'dms.view'], f.userId);

describe('searchVouchersForTransaction', () => {
  it('searches by amount spellings and counterparty, prefers documents without an entry, dedupes', async () => {
    const f = await ledgerFixture();
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -1250, name: 'Futterhaus Beispiel', purpose: 'Rechnung' });
    const entry = await f.finalEntry();
    const linked = insertDocument(f, { subject: 'Rechnung 12.50 EUR', linkedEntryId: entry.id, createdAt: '2026-03-02T10:00:00.000Z' });
    const free = insertDocument(f, { subject: 'Futterhaus Beispiel — Rechnung über 12,50 €' });
    const byName = insertDocument(f, { subject: 'Futterhaus Beispiel Lieferschein', typeKey: 'voucher-receipt' });
    insertDocument(f, { subject: 'Brief 12,50', typeKey: 'letter' }); // keine Belegart
    insertDocument(f, { subject: 'Rechnung 12,50 widerrufen', voided: true });

    const res = unwrap(await searchVouchersForTransaction(f.deps, reader(f), { rawTransactionId: rawId }));
    expect(res.queries).toEqual(['12,50', '12.50', 'Futterhaus Beispiel']);
    expect(res.hits.map((h) => h.documentId)).toEqual([free, byName, linked]);
    expect(res.hits[0]).toMatchObject({ documentId: free, typeKey: 'voucher-invoice', documentDate: '2026-03-01', matchedBy: ['amount', 'counterparty'] });
    expect(res.hits[1]!.matchedBy).toEqual(['counterparty']);
    expect(res.hits[2]!.matchedBy).toEqual(['amount']);

    expect(unwrap(await searchVouchersForTransaction(f.deps, reader(f), { rawTransactionId: rawId, limit: 1 })).hits.map((h) => h.documentId)).toEqual([free]);
  });

  it('writes large amounts with a thousands separator, too, and needs finance.read', async () => {
    const f = await ledgerFixture();
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 123456, name: null });
    expect(unwrap(await searchVouchersForTransaction(f.deps, reader(f), { rawTransactionId: rawId })).queries).toEqual(['1234,56', '1234.56', '1.234,56']);
    expect(await searchVouchersForTransaction(f.deps, ctxWith(['finance.overview', 'dms.view']), { rawTransactionId: rawId })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.read' } });
    expect(await searchVouchersForTransaction(f.deps, reader(f), {})).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await searchVouchersForTransaction(f.deps, reader(f), { rawTransactionId: 'nope' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });
});

describe('attachVoucherToTransaction', () => {
  it('attaches to the existing draft instead of creating a second one', async () => {
    const f = await ledgerFixture();
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -1990 });
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Büromaterial', moneyLines: [{ accountId: f.bank.id, amountCents: -1990, rawTransactionId: rawId }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1990 }] }));

    const res = unwrap(await attachVoucherToTransaction(f.deps, f.ctx, { rawTransactionId: rawId, bytes: pdfBytes() }));
    expect(res).toMatchObject({ entryId: draft.id, createdEntry: false });
    expect(f.deps.db.select().from(financeEntries).all()).toHaveLength(1);
    expect(unwrap(await getEntry(f.deps, f.ctx, { id: draft.id })).vouchers).toMatchObject([{ documentId: res.voucher.documentId }]);
  });

  it('creates the draft from the suggestion when there is none and files the pdf in the entry’s name without a person’s name in the subject', async () => {
    const f = await ledgerFixture();
    unwrap(await saveImportRule(f.deps, f.ctx, { name: 'Büromaterial', textContains: 'büromaterial', categoryId: f.programCosts.id }));
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -1990, name: 'Erika Beispiel', purpose: 'Büromaterial März', date: '2026-03-07' });
    const bookkeeper = ctxWith(['finance.read', 'finance.entriesWrite'], f.userId); // kein dms.*

    const res = unwrap(await attachVoucherToTransaction(f.deps, bookkeeper, { rawTransactionId: rawId, bytes: pdfBytes() }));
    expect(res.createdEntry).toBe(true);
    const entry = unwrap(await getEntry(f.deps, f.ctx, { id: res.entryId }));
    expect(entry).toMatchObject({ status: 'draft', reviewedAt: null, entryDate: '2026-03-07' });
    expect(entry.moneyLines).toMatchObject([{ accountId: f.bank.id, amountCents: -1990, rawTransactionId: rawId }]);
    expect(entry.allocationLines).toMatchObject([{ categoryId: f.programCosts.id, amountCents: -1990 }]);

    const doc = f.deps.db.select().from(documents).where(eq(documents.id, res.voucher.documentId)).get()!;
    expect(doc).toMatchObject({ typeKey: 'voucher-invoice', documentDate: '2026-03-07' });
    expect(doc.subject).toContain(entry.id);
    expect(doc.subject).toContain(f.programCosts.name);
    expect(doc.subject).not.toMatch(/Erika|Beispiel/);
    expect(f.deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, entry.id)).all()).toHaveLength(1);
  });

  it('files an incoming payment as a receipt, falls back to a bare draft without a suggestion, and keeps no draft when the file is refused', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const incoming = insertRaw(f, run, { accountId: f.bank.id, amountCents: 2500, iban: null, purpose: 'Irgendwas' });
    const res = unwrap(await attachVoucherToTransaction(f.deps, f.ctx, { rawTransactionId: incoming, bytes: pdfBytes(), entryTextIfNew: 'Eingang mit Quittung' }));
    const entry = unwrap(await getEntry(f.deps, f.ctx, { id: res.entryId }));
    expect(entry).toMatchObject({ text: 'Eingang mit Quittung', allocationLines: [] });
    expect(f.deps.db.select().from(documents).where(eq(documents.id, res.voucher.documentId)).get()!.typeKey).toBe('voucher-receipt');

    const other = insertRaw(f, run, { accountId: f.bank.id, amountCents: 700, iban: null });
    const notAPdf = new TextEncoder().encode('kein PDF');
    expect(await attachVoucherToTransaction(f.deps, f.ctx, { rawTransactionId: other, bytes: notAPdf })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(f.deps.db.select().from(financeEntries).all()).toHaveLength(1);

    expect(await attachVoucherToTransaction(f.deps, ctxWith(['finance.read'], f.userId), { rawTransactionId: other, bytes: pdfBytes() })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.entriesWrite' } });
    expect(await attachVoucherToTransaction(f.deps, f.ctx, { rawTransactionId: other, bytes: pdfBytes(), typeKey: 'letter' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'voucherTypeNotAllowed' } });
    expect(f.deps.db.select().from(financeEntries).all()).toHaveLength(1);
  });
});
