import { unwrap } from '@kompass/core';
import { documentLinks, documents, documentTypes } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount } from '../src/ledger/accounts';
import { createCategory } from '../src/ledger/categories';
import { deleteDraft, saveDraft } from '../src/ledger/entries';
import { financeAllocationLines, financeEntries, financeEntryDocuments, financeMoneyLines } from '../src/schema';
import { setupFinance } from './helpers';

/** Wie in `entry-immutability.test.ts`: Konto und Kategorie entstehen über die F1-Dienste. */
async function fixtures() {
  const { deps, ctx } = setupFinance();
  const account = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE02120300000000202051', isMain: true }));
  const category = unwrap(await createCategory(deps, ctx, { key: 'donations', name: 'Spenden', direction: 'income', sphere: 'ideal', incomeKind: 'donation' }));
  return { deps, ctx, accountId: account.id, categoryId: category.id };
}

function seedEntry(deps: Awaited<ReturnType<typeof fixtures>>['deps'], accountId: string, categoryId: string, status: 'draft' | 'final') {
  const now = '2026-03-01T10:00:00.000Z';
  deps.db.insert(financeEntries).values({ id: 'E1', number: null, entryDate: '2026-03-01', text: 'Test', status: 'draft', createdByUserId: 'U1', createdChannel: 'ui', createdAt: now, updatedAt: now }).run();
  deps.db.insert(financeMoneyLines).values({ id: 'M1', entryId: 'E1', position: 0, accountId, amountCents: 5000 }).run();
  deps.db.insert(financeAllocationLines).values({ id: 'L1', entryId: 'E1', position: 0, categoryId, amountCents: 5000, taxCode: 'none', rateKind: 'standard', abroad: false, addsToAssets: false }).run();
  if (status === 'final') deps.db.update(financeEntries).set({ status: 'final', number: '2026-0001', finalizedAt: now, finalizedByUserId: 'U1', finalizedChannel: 'ui' }).where(eq(financeEntries.id, 'E1')).run();
}

function seedLink(deps: Awaited<ReturnType<typeof fixtures>>['deps'], id: string, entryId: string, documentId: string | null) {
  const now = '2026-03-01T10:00:00.000Z';
  deps.db.insert(financeEntryDocuments).values({ id, entryId, documentId, documentNumber: 'ERE-2026-0001', documentChecksum: 'abc', documentDeletedAt: null, addedAt: now, addedByUserId: 'U1', revokedAt: null, revokedByUserId: null, revokeNote: null, replacedByLinkId: null }).run();
}

const PERMANENT = /finance voucher link is permanent/;

describe('the link between an entry and its voucher', () => {
  it('can be removed while the entry is a draft', async () => {
    const f = await fixtures();
    seedEntry(f.deps, f.accountId, f.categoryId, 'draft');
    seedLink(f.deps, 'D1', 'E1', 'DOC1');
    f.deps.db.delete(financeEntryDocuments).where(eq(financeEntryDocuments.id, 'D1')).run();
    expect(f.deps.db.select().from(financeEntryDocuments).all()).toHaveLength(0);
  });

  it('cannot be deleted once the entry is finalized', async () => {
    const f = await fixtures();
    seedEntry(f.deps, f.accountId, f.categoryId, 'final');
    seedLink(f.deps, 'D1', 'E1', 'DOC1');
    expect(() => f.deps.db.delete(financeEntryDocuments).where(eq(financeEntryDocuments.id, 'D1')).run()).toThrow(PERMANENT);
  });

  it('never changes what it points at: entry, document number and checksum, who added it and when', async () => {
    for (const status of ['draft', 'final'] as const) {
      const f = await fixtures();
      seedEntry(f.deps, f.accountId, f.categoryId, status);
      seedLink(f.deps, 'D1', 'E1', 'DOC1');
      const update = () => f.deps.db.update(financeEntryDocuments);
      for (const change of [{ entryId: 'E0' }, { documentNumber: 'ERE-2026-0002' }, { documentChecksum: 'zzz' }, { addedAt: '2026-04-01T00:00:00.000Z' }, { addedByUserId: 'U2' }]) {
        expect(() => update().set(change).where(eq(financeEntryDocuments.id, 'D1')).run(), `${status} ${JSON.stringify(change)}`).toThrow(PERMANENT);
      }
    }
  });

  it('the document id can only be cleared, never pointed elsewhere', async () => {
    const f = await fixtures();
    seedEntry(f.deps, f.accountId, f.categoryId, 'draft');
    seedLink(f.deps, 'D1', 'E1', 'DOC1');
    expect(() => f.deps.db.update(financeEntryDocuments).set({ documentId: 'DOC2' }).where(eq(financeEntryDocuments.id, 'D1')).run()).toThrow(PERMANENT);
    f.deps.db.update(financeEntryDocuments).set({ documentId: null }).where(eq(financeEntryDocuments.id, 'D1')).run();
    expect(f.deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.id, 'D1')).get()!.documentId).toBeNull();
  });

  it('takes a revocation — once: revokedAt, revokedByUserId, revokeNote, replacedByLinkId', async () => {
    const f = await fixtures();
    seedEntry(f.deps, f.accountId, f.categoryId, 'final');
    seedLink(f.deps, 'D1', 'E1', 'DOC1');
    seedLink(f.deps, 'D2', 'E1', 'DOC2');
    f.deps.db.update(financeEntryDocuments).set({ revokedAt: '2026-04-01T00:00:00.000Z', revokedByUserId: 'U2', revokeNote: 'falsch zugeordnet', replacedByLinkId: 'D2' }).where(eq(financeEntryDocuments.id, 'D1')).run();
    const row = f.deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.id, 'D1')).get()!;
    expect(row).toMatchObject({ revokedByUserId: 'U2', revokeNote: 'falsch zugeordnet', replacedByLinkId: 'D2' });
    expect(row.revokedAt).not.toBeNull();
  });

  it('a revocation cannot be undone or rewritten', async () => {
    const f = await fixtures();
    seedEntry(f.deps, f.accountId, f.categoryId, 'draft');
    seedLink(f.deps, 'D1', 'E1', 'DOC1');
    f.deps.db.update(financeEntryDocuments).set({ revokedAt: '2026-04-01T00:00:00.000Z', revokedByUserId: 'U2', revokeNote: 'falsch' }).where(eq(financeEntryDocuments.id, 'D1')).run();
    expect(() => f.deps.db.update(financeEntryDocuments).set({ revokedAt: null }).where(eq(financeEntryDocuments.id, 'D1')).run()).toThrow(PERMANENT);
    expect(() => f.deps.db.update(financeEntryDocuments).set({ revokeNote: 'anders' }).where(eq(financeEntryDocuments.id, 'D1')).run()).toThrow(PERMANENT);
  });

  it('one document hangs on an entry only once', async () => {
    const f = await fixtures();
    seedEntry(f.deps, f.accountId, f.categoryId, 'draft');
    seedLink(f.deps, 'D1', 'E1', 'DOC1');
    expect(() => seedLink(f.deps, 'D2', 'E1', 'DOC1')).toThrow(/UNIQUE/);
  });
});

describe('deleting a draft', () => {
  it('takes its voucher links with it and releases the file module’s links — the document itself stays filed', async () => {
    const f = await fixtures();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.accountId, amountCents: 5000 }], allocationLines: [{ categoryId: f.categoryId, amountCents: 5000 }] }));
    f.deps.db.insert(documentTypes).values({ key: 'voucher-invoice', label: 'Eingangsrechnung', prefix: 'ERE', defaultDirection: 'incoming', retentionClass: 'statutory8Y', defaultFolder: null, isActive: true, sortOrder: 0, ownerModule: null, protectionArea: 'finance' }).run();
    const now = '2026-03-01T10:00:00.000Z';
    f.deps.db.insert(documents).values({ id: 'DOC1', phase: 'issued', direction: 'incoming', sourceKind: 'uploaded', typeKey: 'voucher-invoice', number: 'ERE-2026-0001', subject: 'Beleg vom 2026-03-01', documentDate: '2026-03-01', folder: null, draftBody: null, fileName: 'x', fileChecksum: 'abc', fileBytes: 1, textStatus: 'unavailable', textAttempts: 0, textError: null, textExtractedAt: null, status: 'issued', createdByUserId: 'U1', createdAt: now, updatedAt: now }).run();
    f.deps.db.insert(documentLinks).values({ id: 'LINK1', documentId: 'DOC1', entityType: 'financeEntry', entityId: draft.id, role: 'about', createdAt: now }).run();
    seedLink(f.deps, 'D1', draft.id, 'DOC1');

    unwrap(await deleteDraft(f.deps, f.ctx, { id: draft.id }));

    expect(f.deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, draft.id)).all()).toHaveLength(0);
    expect(f.deps.db.select().from(documentLinks).where(eq(documentLinks.entityId, draft.id)).all()).toHaveLength(0);
    expect(f.deps.db.select().from(documents).where(eq(documents.id, 'DOC1')).get()).not.toBeUndefined();
  });
});
