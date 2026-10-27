import { newId, unwrap } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bookEntry } from '../src/ledger/finalize';
import { reverseEntry } from '../src/ledger/reverse';
import { reusedEvidenceInternal } from '../src/reporting/reused-evidence';
import { financeEntryDocuments, financeExpenseClaims, financeExpensePositions } from '../src/schema';
import { insertDocument, ledgerFixture } from './helpers';
import { insertPartner, insertPartnerEvidence, insertPartnerPayment } from './partner-fixture';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;
const YEAR = { from: '2026-01-01', to: '2026-12-31' };

const entry = (f: Fixture, date = '2026-03-01') =>
  bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Ausgabe', moneyLines: [{ accountId: f.bank.id, amountCents: -1000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1000, taxCode: 'none' }] }).then(unwrap);

/** Ein eigenes Dokument mit eigener Prüfsumme (oder einer genannten). */
function doc(f: Fixture, checksum: string = newId()): string {
  const id = insertDocument(f, { subject: 'Rechnung' });
  f.deps.db.update(documents).set({ fileChecksum: checksum }).where(eq(documents.id, id)).run();
  return id;
}

function link(f: Fixture, entryId: string, documentId: string, o: { revoked?: boolean } = {}) {
  const row = f.deps.db.select().from(documents).where(eq(documents.id, documentId)).get()!;
  f.deps.db
    .insert(financeEntryDocuments)
    .values({ id: newId(), entryId, documentId, documentNumber: row.number!, documentChecksum: row.fileChecksum, addedAt: '2026-03-01T10:00:00.000Z', addedByUserId: f.userId, ...(o.revoked ? { revokedAt: '2026-03-02T10:00:00.000Z', revokedByUserId: f.userId } : {}) })
    .run();
}

describe('reusedEvidenceInternal (Rechenschaft B1 Task 8)', () => {
  it('finds one document on two entries', async () => {
    const f = await ledgerFixture();
    const [a, b] = [await entry(f), await entry(f, '2026-04-01')];
    const d = doc(f);
    link(f, a.id, d);
    link(f, b.id, d);
    const groups = reusedEvidenceInternal(f.deps.db, YEAR);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.uses.map((u) => [u.kind, u.refId])).toEqual([['voucher', a.id], ['voucher', b.id]]);
    expect(groups[0]!.uses[0]).toMatchObject({ refNumber: a.number, date: '2026-03-01', documentId: d });
  });

  it('does not count an entry and its reversal', async () => {
    const f = await ledgerFixture();
    const a = await entry(f);
    const d = doc(f);
    link(f, a.id, d);
    const reversal = unwrap(await reverseEntry(f.deps, f.ctx, { id: a.id }));
    link(f, reversal.reversal.id, d);
    expect(reusedEvidenceInternal(f.deps.db, YEAR)).toEqual([]);
  });

  it('does not count an expense claim and the entry that reimburses it', async () => {
    const f = await ledgerFixture();
    const a = await entry(f);
    const d = doc(f);
    link(f, a.id, d);
    const claimId = newId();
    f.deps.db.insert(financeExpenseClaims).values({ id: claimId, number: 'AL-2026-0001', contactId: f.donor.id, submittedByUserId: f.userId, state: 'draft', createdAt: 'x', updatedAt: 'x' } as never).run();
    f.deps.db.insert(financeExpensePositions).values({ id: newId(), claimId, sortOrder: 1, kind: 'receipt', positionDate: '2026-02-27', amountCents: 1000, documentId: d }).run();
    f.deps.db.update(financeExpenseClaims).set({ state: 'submitted', submittedAt: '2026-02-28T10:00:00.000Z' }).where(eq(financeExpenseClaims.id, claimId)).run();
    expect(reusedEvidenceInternal(f.deps.db, YEAR)).toEqual([]);
  });

  it('finds the same file uploaded twice by its checksum', async () => {
    const f = await ledgerFixture();
    const [a, b] = [await entry(f), await entry(f)];
    link(f, a.id, doc(f, 'same-file'));
    link(f, b.id, doc(f, 'same-file'));
    expect(reusedEvidenceInternal(f.deps.db, YEAR)).toEqual([expect.objectContaining({ checksum: 'same-file', uses: [expect.objectContaining({ refId: a.id }), expect.objectContaining({ refId: b.id })] })]);
  });

  it('ignores a revoked link', async () => {
    const f = await ledgerFixture();
    const [a, b] = [await entry(f), await entry(f)];
    const d = doc(f);
    link(f, a.id, d);
    link(f, b.id, d, { revoked: true });
    expect(reusedEvidenceInternal(f.deps.db, YEAR)).toEqual([]);
  });

  it('finds partner evidence on two payments', async () => {
    const f = await ledgerFixture();
    const partnerId = insertPartner(f.deps.db, { contactId: f.donor.id });
    const paymentA = insertPartnerPayment(f.deps.db, partnerId, { state: 'approved', approvedAt: '2026-05-01T10:00:00.000Z' });
    const paymentB = insertPartnerPayment(f.deps.db, partnerId, { state: 'approved', approvedAt: '2026-05-02T10:00:00.000Z' });
    insertPartnerEvidence(f.deps.db, paymentA, { documentId: 'DOC-SHARED', addedAt: '2026-05-03T10:00:00.000Z' });
    expect(reusedEvidenceInternal(f.deps.db, YEAR)).toEqual([]);
    insertPartnerEvidence(f.deps.db, paymentB, { documentId: 'DOC-SHARED', addedAt: '2026-05-04T10:00:00.000Z' });
    const groups = reusedEvidenceInternal(f.deps.db, YEAR);
    expect(groups.map((g) => g.uses.map((u) => [u.kind, u.refId]))).toEqual([[['partnerEvidence', paymentA], ['partnerEvidence', paymentB]]]);
  });

  it('leaves out a group with no use in the range', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const [a, b] = [await entry(f, '2025-03-01'), await entry(f, '2025-04-01')];
    const d = doc(f);
    link(f, a.id, d);
    link(f, b.id, d);
    expect(reusedEvidenceInternal(f.deps.db, YEAR)).toEqual([]);
    expect(reusedEvidenceInternal(f.deps.db, { from: '2025-01-01', to: '2025-12-31' })).toHaveLength(1);
  });
});
