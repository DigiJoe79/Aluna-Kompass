import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unwrap } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { RETURN_CODES, returnCodeInfo } from '../src/direct-debit/return-codes';
import { getPledge } from '../src/direct-debit/pledges';
import { openCentsInternal } from '../src/ledger/open-items';
import { financeAllocationLines, financeDirectDebitReturns, financeEntries } from '../src/schema';
import { bookAndFinalize, bookFromSuggestion, creditScene, suggest, type CreditScene } from './direct-debit-credit-fixture';

// Plan L3 Task 3 (Spec § 6.2, § 7.7; Handoff 2a § 1.6, Nachtrag Phase 2): Rücklastschriften finden ihren Posten im Einzug.

/** Der Einzug ist als Sammelgutschrift gebucht und festgeschrieben: eine Buchung, zwei Zuordnungszeilen. */
async function bookedScene() {
  const f = await creditScene();
  const credit = f.raw(11200);
  const entry = await bookAndFinalize(f, credit, await suggest(f, credit));
  const lineOf = (itemId: string) => f.deps.db.select().from(financeAllocationLines).where(and(eq(financeAllocationLines.entryId, entry.id), eq(financeAllocationLines.directDebitItemId, itemId))).get()!;
  const settlementId = entry.moneyLines[0]!.settlements.find((s) => s.openItemId === f.feeId)!.id;
  return { ...f, entry, lineOf, settlementId };
}

const rateState = async (f: CreditScene) => unwrap(await getPledge(f.deps, f.ctx, { id: f.pledge.id, from: '2026-10-01', to: '2026-10-31' })).rates[0]!.state;
const returnsOf = (f: CreditScene) => f.deps.db.select().from(financeDirectDebitReturns).all();

describe('a return of a direct debit finds its item in the run', () => {
  it('a fee out of a batch credit: only its own line is taken back, the item is open again, the rate stays booked (Review Focus 3)', async () => {
    const f = await bookedScene();
    const fee = f.itemOf('openItem');
    const back = f.raw(-5000, { date: '2026-11-04', returnCode: 'AM04', endToEndId: fee.endToEndId });
    const s = await suggest(f, back);
    expect(s).toMatchObject({ kind: 'return', confidence: 'sure', hints: [], reasons: [{ kind: 'directDebitReturn', runId: f.run.id, collectionDate: '2026-10-30', returnCode: 'AM04', entryId: f.entry.id, entryNumber: f.entry.number, matchedBy: 'endToEnd', returnedItem: { source: 'openItem', installmentOn: null } }] });
    expect(s.draft!.moneyLines[0]!.settlements).toEqual([{ openItemId: f.feeId, amountCents: 5000, reversesSettlementId: f.settlementId }]);
    expect(s.draft!.allocationLines).toEqual([{ categoryId: f.membership, amountCents: -5000, taxCode: 'none', contactId: f.a.contactId, originLineId: f.lineOf(fee.id).id, directDebitItemId: fee.id }]);

    const entry = await bookAndFinalize(f, back, s);
    expect(openCentsInternal(f.deps.db, f.feeId)).toBe(5000);
    expect(await rateState(f)).toBe('booked');
    expect(returnsOf(f)).toMatchObject([{ itemId: fee.id, rawTransactionId: back, entryId: entry.id, returnCode: 'AM04', feeCents: 0, status: 'open', resolution: null, mandateEnded: false }]);
  });

  it('a rate returned with MD06 and a bank fee: the donation line negative, the fee its own line; the rate is returned, the case open', async () => {
    const f = await bookedScene();
    const rate = f.itemOf('pledge');
    const back = f.raw(-6550, { date: '2026-11-04', returnCode: 'MD06', endToEndId: rate.endToEndId });
    const s = await suggest(f, back);
    expect(s).toMatchObject({ kind: 'return', confidence: 'sure' });
    expect(s.draft!.moneyLines[0]!.settlements).toBeUndefined();
    expect(s.draft!.allocationLines).toEqual([
      { categoryId: f.donations, amountCents: -6200, taxCode: 'none', contactId: f.b.contactId, originLineId: f.lineOf(rate.id).id, directDebitItemId: rate.id },
      { categoryId: f.bankFees, amountCents: -350 },
    ]);
    await bookAndFinalize(f, back, s);
    expect(await rateState(f)).toBe('returned');
    expect(openCentsInternal(f.deps.db, f.feeId)).toBe(0);
    expect(returnsOf(f)).toMatchObject([{ itemId: rate.id, returnCode: 'MD06', feeCents: 350, status: 'open' }]);
  });

  it('without end-to-end id over mandate reference and amount', async () => {
    const f = await bookedScene();
    const rate = f.itemOf('pledge');
    const s = await suggest(f, f.raw(-6200, { date: '2026-11-04', returnCode: 'MD06', mandateReference: rate.mandateReference }));
    expect(s).toMatchObject({ kind: 'return', confidence: 'sure', reasons: [{ kind: 'directDebitReturn', runId: f.run.id, matchedBy: 'mandateAndAmount', returnedItem: { source: 'pledge', amountCents: 6200 } }] });
    expect(s.draft!.allocationLines).toMatchObject([{ originLineId: f.lineOf(rate.id).id, directDebitItemId: rate.id }]);
  });

  it('a return while the credit is still a draft: hint originIsDraft, no reversal of a settlement on a draft (Review Focus 5)', async () => {
    const f = await creditScene();
    const credit = f.raw(11200);
    await bookFromSuggestion(f, credit, await suggest(f, credit));
    const fee = f.itemOf('openItem');
    const s = await suggest(f, f.raw(-5000, { date: '2026-11-04', returnCode: 'MD06', endToEndId: fee.endToEndId }));
    expect(s).toMatchObject({ kind: 'return', confidence: 'unsure', hints: ['originIsDraft'], reasons: [{ kind: 'directDebitReturn', runId: f.run.id }] });
    expect(s.draft!.moneyLines[0]!.settlements).toBeUndefined();
    expect(s.draft!.allocationLines).toEqual([{ categoryId: f.membership, amountCents: -5000, taxCode: 'none', contactId: f.a.contactId, directDebitItemId: fee.id }]);
  });

  it('an unrelated return stays with the old way', async () => {
    const f = await bookedScene();
    const s = await suggest(f, f.raw(-999, { date: '2026-11-04', returnCode: 'MD06', endToEndId: 'FREMD-1' }));
    expect(s.reasons.some((r) => r.kind === 'directDebitReturn')).toBe(false);
    expect(f.deps.db.select().from(financeEntries).all()).toHaveLength(1);
  });
});

describe('return codes', () => {
  const messages = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../../apps/kompass/messages/de.json'), 'utf8')) as Record<string, unknown>;
  const text = (key: string) => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);

  it('knows the common codes in plain language; AC04, MD01 and MD06 suggest ending the mandate', () => {
    for (const code of ['AC01', 'AC04', 'AC06', 'AG01', 'AM04', 'MD01', 'MD06', 'MS02', 'MS03', 'SL01']) {
      expect(RETURN_CODES[code], code).toBeDefined();
      expect(typeof text(RETURN_CODES[code]!.textKey), code).toBe('string');
    }
    expect(Object.entries(RETURN_CODES).filter(([, v]) => v.suggestEndMandate).map(([k]) => k).sort()).toEqual(['AC04', 'MD01', 'MD06']);
  });

  it('an unknown code reads „Grund {code}“', () => {
    expect(returnCodeInfo('ZZ99')).toEqual({ code: 'ZZ99', textKey: 'finance.directDebit.returnCodes.unknown', suggestEndMandate: false });
    expect(text('finance.directDebit.returnCodes.unknown')).toBe('Grund {code}');
    expect(returnCodeInfo('MD06')).toMatchObject({ code: 'MD06', suggestEndMandate: true });
  });
});
