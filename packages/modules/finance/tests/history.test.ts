import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { requestAllocationCorrection } from '../src/ledger/corrections';
import { saveDraft, setReviewed } from '../src/ledger/entries';
import { bookEntry, finalizeEntry } from '../src/ledger/finalize';
import { getEntryHistory } from '../src/ledger/history';
import { reverseEntry } from '../src/ledger/reverse';
import { revokeVoucher, uploadVoucher } from '../src/ledger/vouchers';
import { financeAllocationLines } from '../src/schema';
import { ledgerFixture, pdfBytes } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

describe('getEntryHistory: the trail of a booking, from its own columns', () => {
  it('tells created, reviewed and finalized with user name and channel, in order', async () => {
    const f = await ledgerFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
    unwrap(await setReviewed(f.deps, f.ctx, { id: draft.id, reviewed: true, expectedVersion: draft.updatedAt }));
    const finalized = unwrap(await finalizeEntry(f.deps, f.ctx, { id: draft.id }));

    const { events } = unwrap(await getEntryHistory(f.deps, f.ctx, { id: finalized.id }));
    expect(events.map((e) => e.kind)).toEqual(['created', 'reviewed', 'finalized']);
    expect(events[0]).toMatchObject({ kind: 'created', channel: 'ui', userName: 'Test' });
    expect(events[1]).toMatchObject({ kind: 'reviewed', channel: null, userName: 'Test' });
    expect(events[2]).toMatchObject({ kind: 'finalized', channel: 'ui', userName: 'Test' });
  });

  it('tells an applied allocation change with before, after and note', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalDonation({ date: '2026-03-01', cents: 5000, contactId: f.donor.id });
    const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!;
    const requested = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.wrongDonor.id }, note: 'Falscher Spender eingetragen' }));
    expect(requested.applied).toBe(true); // Jahr offen: sofort wirksam.

    const { events } = unwrap(await getEntryHistory(f.deps, f.ctx, { id: entry.id }));
    const change = events.find((e) => e.kind === 'allocationChanged')!;
    expect(change).toMatchObject({ kind: 'allocationChanged', state: 'applied', note: 'Falscher Spender eingetragen', correctionId: requested.correction.id });
    expect((change as { before: unknown }).before).toEqual({ contactId: f.donor.id, projectId: null, purposeId: null, abroad: false });
    expect((change as { after: unknown }).after).toEqual({ contactId: f.wrongDonor.id });
  });

  it('tells a pending change in a closed year as pending', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const entry = await f.finalDonation({ date: '2025-06-01', cents: 5000, contactId: f.donor.id });
    f.closeYear(f.years['2025']!.id);
    const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!;
    const requested = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.wrongDonor.id }, note: 'Falscher Spender eingetragen' }));
    expect(requested.applied).toBe(false);

    const { events } = unwrap(await getEntryHistory(f.deps, f.ctx, { id: entry.id }));
    const change = events.find((e) => e.kind === 'allocationChanged')!;
    expect(change).toMatchObject({ state: 'pending', note: 'Falscher Spender eingetragen', correctionId: requested.correction.id });
  });

  it('tells that and by which number the entry was taken back', async () => {
    const f = await ledgerFixture();
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
    const { reversal } = unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id }));

    const { events } = unwrap(await getEntryHistory(f.deps, f.ctx, { id: entry.id }));
    const reversed = events.find((e) => e.kind === 'reversed')!;
    expect(reversed).toMatchObject({ kind: 'reversed', byEntryId: reversal.id, byNumber: reversal.number });
  });

  it('tells added and revoked vouchers by document number, never by title', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalEntry();
    const voucher = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-own', documentDate: '2026-03-01' }));
    unwrap(await revokeVoucher(f.deps, f.ctx, { linkId: voucher.linkId, note: 'Falscher Anhang aus Versehen hochgeladen' }));

    const { events } = unwrap(await getEntryHistory(f.deps, f.ctx, { id: entry.id }));
    const added = events.find((e) => e.kind === 'voucherAdded')!;
    const revoked = events.find((e) => e.kind === 'voucherRevoked')!;
    expect(added).toMatchObject({ kind: 'voucherAdded', documentNumber: voucher.documentNumber });
    expect(revoked).toMatchObject({ kind: 'voucherRevoked', documentNumber: voucher.documentNumber });
    expect(JSON.stringify(events)).not.toContain('Falscher Anhang'); // Widerrufsnotiz steht nie im Verlauf.
  });

  it('refuses without finance.read', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalEntry();
    expect(err(await getEntryHistory(f.deps, ctxWith(['finance.overview']), { id: entry.id }))).toEqual({ type: 'forbidden', permission: 'finance.read' });
  });
});
