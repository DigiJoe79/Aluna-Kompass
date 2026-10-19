import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { listDirectDebitReturns } from '../src/direct-debit/returns';
import { bookAndFinalize, creditScene, suggest } from './direct-debit-credit-fixture';

// Plan N1 Task 5 (M19, M37). Uhr: 20.10.2026; Einzug zum 30.10. mit einem Beitrag und einer Rate (112,00 €).

describe('text of a direct debit credit (M19)', () => {
  it('a batch credit is booked as „Lastschrifteinzug <Tag> (<n> Posten)“, not as the bare date', async () => {
    const f = await creditScene();
    expect((await suggest(f, f.raw(11200))).draft!.text).toBe('Lastschrifteinzug 30.10.2026 (2 Posten)');
  });
});

describe('the bank fee of a return as its own line (M37)', () => {
  it('a debit „Entgelt Rücklastschrift“ on the day of a return becomes the fee of that return', async () => {
    const f = await creditScene();
    const credit = f.raw(11200);
    await bookAndFinalize(f, credit, await suggest(f, credit));
    f.raw(-6200, { date: '2026-11-04', returnCode: 'MD06', endToEndId: f.itemOf('pledge').endToEndId });
    const fee = f.raw(-300, { date: '2026-11-04', purpose: 'Entgelt Ruecklastschrift' });
    const s = await suggest(f, fee);
    expect(s).toMatchObject({ kind: 'fee', confidence: 'unsure', reasons: [{ kind: 'directDebitReturnFee' }] });
    expect(s.draft!.allocationLines).toEqual([{ categoryId: f.bankFees, amountCents: -300 }]);
  });

  it('names the day of the collection and, finalized, becomes the fee of the one return that day (U3)', async () => {
    const f = await creditScene();
    const credit = f.raw(11200);
    await bookAndFinalize(f, credit, await suggest(f, credit));
    const fee = f.raw(-300, { date: '2026-11-04', purpose: 'Entgelt Ruecklastschrift' });
    const back = f.raw(-6200, { date: '2026-11-04', returnCode: 'MD06', endToEndId: f.itemOf('pledge').endToEndId });
    // Das Entgelt zuerst: Die Rückgabe ist noch nicht gebucht, der Einzugstag kommt aus dem zurückgegebenen Posten.
    const s = await suggest(f, fee);
    expect(s.reasons).toEqual([{ kind: 'directDebitReturnFee', collectionDate: '2026-10-30' }]);
    await bookAndFinalize(f, fee, s);
    await bookAndFinalize(f, back, await suggest(f, back));
    const returns = unwrap(await listDirectDebitReturns(f.deps, f.ctx, {})).items;
    expect(returns).toMatchObject([{ source: 'pledge', feeCents: 300 }]);
  });

  it('with two returns that day nothing is guessed: the fee stays its own entry (U3)', async () => {
    const f = await creditScene();
    const credit = f.raw(11200);
    await bookAndFinalize(f, credit, await suggest(f, credit));
    const one = f.raw(-6200, { date: '2026-11-04', returnCode: 'MD06', endToEndId: f.itemOf('pledge').endToEndId });
    const two = f.raw(-5000, { date: '2026-11-04', returnCode: 'AM04', endToEndId: f.itemOf('openItem').endToEndId });
    await bookAndFinalize(f, one, await suggest(f, one));
    await bookAndFinalize(f, two, await suggest(f, two));
    const fee = f.raw(-300, { date: '2026-11-04', purpose: 'Entgelt Ruecklastschrift' });
    const s = await suggest(f, fee);
    expect(s.reasons).toEqual([{ kind: 'directDebitReturnFee', collectionDate: '2026-10-30' }]);
    await bookAndFinalize(f, fee, s);
    expect(unwrap(await listDirectDebitReturns(f.deps, f.ctx, {})).items.map((r) => r.feeCents)).toEqual([0, 0]);
  });

  it('without a return that day it is no return fee', async () => {
    const f = await creditScene();
    const fee = f.raw(-300, { date: '2026-11-04', purpose: 'Entgelt Ruecklastschrift' });
    expect((await suggest(f, fee)).reasons).not.toContainEqual(expect.objectContaining({ kind: 'directDebitReturnFee' }));
  });
});
