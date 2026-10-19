import { fixedClock, unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getPledge } from '../src/direct-debit/pledges';
import { endMandate } from '../src/direct-debit/mandates';
import { getDirectDebitRun, listDirectDebitRuns } from '../src/direct-debit/runs';
import { reverseEntry } from '../src/ledger/reverse';
import { financeDirectDebitRuns } from '../src/schema';
import { openCentsInternal } from '../src/ledger/open-items';
import { bookAndFinalize, creditScene as scene, suggest } from './direct-debit-credit-fixture';

// Plan L3 Task 2 (Spec § 7.6): die Gutschrift eines eingereichten Einzugs. Uhr: Dienstag, 20.10.2026; Einzug zum 30.10.

describe('suggestion directDebitRun — single lines (TxDtls)', () => {
  it('each line finds its item over the end-to-end id: a fee settles its open item, a rate becomes a donation (Review Focus 2)', async () => {
    const f = await scene();
    const fee = f.itemOf('openItem');
    const rate = f.itemOf('pledge');
    const feeRaw = f.raw(5000, { endToEndId: fee.endToEndId });
    const rateRaw = f.raw(6200, { endToEndId: rate.endToEndId });

    const s1 = await suggest(f, feeRaw);
    expect(s1).toMatchObject({ kind: 'directDebitRun', confidence: 'sure', reasons: [{ kind: 'directDebitRun', runId: f.run.id, collectionDate: '2026-10-30', matchedBy: 'endToEnd', itemCount: 1 }] });
    expect(s1.draft!.moneyLines).toEqual([{ accountId: f.bank.id, amountCents: 5000, rawTransactionId: feeRaw, settlements: [{ openItemId: f.feeId, amountCents: 5000 }] }]);
    expect(s1.draft!.allocationLines).toEqual([{ categoryId: f.membership, amountCents: 5000, contactId: f.a.contactId, directDebitItemId: fee.id }]);

    const s2 = await suggest(f, rateRaw);
    expect(s2).toMatchObject({ kind: 'directDebitRun', confidence: 'sure' });
    expect(s2.draft!.moneyLines).toEqual([{ accountId: f.bank.id, amountCents: 6200, rawTransactionId: rateRaw }]);
    expect(s2.draft!.allocationLines).toEqual([{ categoryId: f.donations, amountCents: 6200, contactId: f.b.contactId, directDebitItemId: rate.id }]);
  });

  it('a rate is never an open item: booked, it is a donation with its entry number; once all lines are final, the run is booked', async () => {
    const f = await scene();
    const feeRaw = f.raw(5000, { endToEndId: f.itemOf('openItem').endToEndId });
    const rateRaw = f.raw(6200, { endToEndId: f.itemOf('pledge').endToEndId });
    await bookAndFinalize(f, feeRaw, await suggest(f, feeRaw));
    expect(unwrap(await getDirectDebitRun(f.deps, f.ctx, { id: f.run.id })).status).toBe('submitted');
    const entry = await bookAndFinalize(f, rateRaw, await suggest(f, rateRaw));
    expect(openCentsInternal(f.deps.db, f.feeId)).toBe(0);
    const rates = unwrap(await getPledge(f.deps, f.ctx, { id: f.pledge.id, from: '2026-10-01', to: '2026-10-31' })).rates;
    expect(rates).toEqual([{ dueOn: '2026-10-30', amountCents: 6200, state: 'booked', entryId: entry.id, entryNumber: entry.number, run: { id: f.run.id, collectionDate: '2026-10-30' } }]);
    expect(unwrap(await getDirectDebitRun(f.deps, f.ctx, { id: f.run.id })).status).toBe('booked');
  });
});

describe('suggestion directDebitRun — batch credit without single lines', () => {
  it('the full sum of exactly one run: one entry with all items, sure', async () => {
    const f = await scene();
    const raw = f.raw(11200);
    const s = await suggest(f, raw);
    expect(s).toMatchObject({ kind: 'directDebitRun', confidence: 'sure', reasons: [{ kind: 'directDebitRun', runId: f.run.id, collectionDate: '2026-10-30', matchedBy: 'sum', itemCount: 2 }] });
    expect(s.draft!.moneyLines).toEqual([{ accountId: f.bank.id, amountCents: 11200, rawTransactionId: raw, settlements: [{ openItemId: f.feeId, amountCents: 5000 }] }]);
    expect(s.draft!.allocationLines).toEqual([
      { categoryId: f.membership, amountCents: 5000, contactId: f.a.contactId, directDebitItemId: f.itemOf('openItem').id },
      { categoryId: f.donations, amountCents: 6200, contactId: f.b.contactId, directDebitItemId: f.itemOf('pledge').id },
    ]);
  });

  it('net of the bank fee (112,00 € run, 110,50 € credit): a fee line of 1,50 € and unsure (Review Focus 1)', async () => {
    const f = await scene();
    const s = await suggest(f, f.raw(11050));
    expect(s).toMatchObject({ kind: 'directDebitRun', confidence: 'unsure' });
    expect(s.draft!.allocationLines.at(-1)).toEqual({ categoryId: f.bankFees, amountCents: -150 });
    expect(s.draft!.allocationLines.reduce((sum, l) => sum + l.amountCents, 0)).toBe(11050);
  });

  it('before the collection day, or more than the run, it is not the credit of the run', async () => {
    const f = await scene();
    expect((await suggest(f, f.raw(11200, { date: '2026-10-29' }))).kind).not.toBe('directDebitRun');
    expect((await suggest(f, f.raw(11300, {}))).kind).not.toBe('directDebitRun');
  });

  it('two runs with the same sum on the same day: possible, both as candidates, no draft (Review Focus 4)', async () => {
    const f = await scene({ secondRun: true });
    const s = await suggest(f, f.raw(11200));
    expect(s).toMatchObject({ kind: 'directDebitRun', confidence: 'possible', draft: null });
    expect(s.reasons[0]!.runCandidates!.map((c) => c.runId).sort()).toEqual([f.run.id, f.other!.id].sort());
  });

  it('booked as a whole, the fee is settled, the rate booked and the run booked', async () => {
    const f = await scene();
    const raw = f.raw(11050);
    const entry = await bookAndFinalize(f, raw, await suggest(f, raw));
    expect(openCentsInternal(f.deps.db, f.feeId)).toBe(0);
    const rates = unwrap(await getPledge(f.deps, f.ctx, { id: f.pledge.id, from: '2026-10-01', to: '2026-10-31' })).rates;
    expect(rates).toMatchObject([{ state: 'booked', entryNumber: entry.number }]);
    expect(unwrap(await getDirectDebitRun(f.deps, f.ctx, { id: f.run.id })).status).toBe('booked');
    // Nach dem Buchen passt ein weiterer Eingang nicht mehr zum Einzug.
    expect((await suggest(f, f.raw(11200, {}))).kind).not.toBe('directDebitRun');
  });

  it('the run summary is attached as voucher once the credit is finalized (L3 Nacharbeit, Spec § 7.4 Schritt 3)', async () => {
    const f = await scene();
    const raw = f.raw(11050);
    const entry = await bookAndFinalize(f, raw, await suggest(f, raw));
    const summaryId = unwrap(await getDirectDebitRun(f.deps, f.ctx, { id: f.run.id })).summaryDocumentId;
    expect(summaryId).not.toBeNull();
    expect(entry.vouchers.filter((v) => v.revokedAt === null).map((v) => v.documentId)).toEqual([summaryId]);
    expect(entry.documentation.state).toBe('voucher');
  });

  it('booked is computed: the stored state stays submitted; reversing the credit makes the run submitted again and its items unbooked (L3 Nacharbeit)', async () => {
    const f = await scene();
    const raw = f.raw(11200);
    const entry = await bookAndFinalize(f, raw, await suggest(f, raw));
    const later = { ...f.deps, clock: fixedClock('2026-11-10T08:00:00.000Z') };
    expect(f.deps.db.select().from(financeDirectDebitRuns).where(eq(financeDirectDebitRuns.id, f.run.id)).get()!.status).toBe('submitted');
    expect(unwrap(await listDirectDebitRuns(later, f.ctx, { status: 'booked' })).items.map((r) => r.id)).toEqual([f.run.id]);
    // Gebucht bindet das Mandat nicht mehr: es lässt sich beenden.
    expect((await endMandate(later, f.ctx, { mandateId: f.a.mandateId, endedOn: '2026-11-10', reason: 'debtor' })).ok).toBe(true);

    unwrap(await reverseEntry(later, f.ctx, { id: entry.id }));
    expect(unwrap(await getDirectDebitRun(later, f.ctx, { id: f.run.id })).status).toBe('submitted');
    expect(unwrap(await listDirectDebitRuns(later, f.ctx, { status: 'booked' })).items).toEqual([]);
    expect(openCentsInternal(f.deps.db, f.feeId)).toBe(5000);
    expect(unwrap(await getPledge(later, f.ctx, { id: f.pledge.id, from: '2026-10-01', to: '2026-10-31' })).rates[0]!.state).toBe('inRun');
  });
});
