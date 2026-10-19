import { fixedClock, unwrap, type Deps } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { amendMandate, endMandate } from '../src/direct-debit/mandates';
import { getPledge, savePledge } from '../src/direct-debit/pledges';
import { buildDirectDebitFile, cancelDirectDebitRun, createDirectDebitRun, getDirectDebitRun, markDirectDebitRunSubmitted, previewDirectDebitRun } from '../src/direct-debit/runs';
import { suggestForTransaction } from '../src/import/suggestions';
import { financeDirectDebitItems, financePledgeRateMarks } from '../src/schema';
import { directDebitFixture, IBANS } from './direct-debit-fixture';
import { insertRaw, insertRun } from './helpers';
import { eq } from 'drizzle-orm';

// Plan N1 Task 5 (M41, M15, M14, M40, M28, M32). Uhr: Dienstag, 20.10.2026.
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);
const at = (deps: Deps, day: string): Deps => ({ ...deps, clock: fixedClock(`${day}T08:00:00.000Z`) });

/** Ein Beitrag zum 30.10., angekündigt, im Einzug mit Datei — nie eingereicht. */
async function withFile() {
  const f = await directDebitFixture();
  const a = await f.payer('Beispiel');
  const item = await f.fee(a, 1200, '2026-10-30');
  f.announce(a.mandateId, [{ dueOn: '2026-10-30', amountCents: 1200 }]);
  const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
  unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: run.id }));
  return { ...f, a, item, run };
}

describe('a run never submitted expires (M41)', () => {
  it('after submitBy it is expired; its items are free for a new preview; it can be discarded', async () => {
    const f = await withFile();
    const later = at(f.deps, '2026-11-15');
    expect(unwrap(await getDirectDebitRun(later, f.ctx, { id: f.run.id })).status).toBe('expired');
    // Am 28.10. (submitBy) noch nicht verfallen.
    expect(unwrap(await getDirectDebitRun(at(f.deps, '2026-10-28'), f.ctx, { id: f.run.id })).status).toBe('fileCreated');
    f.announce(f.a.mandateId, [{ dueOn: '2026-11-20', amountCents: 1200 }], '2026-11-01');
    const preview = unwrap(await previewDirectDebitRun(later, f.ctx, { collectionDate: '2026-11-20' }));
    expect(preview.included.map((i) => i.sourceId)).toEqual([f.item]);
    expect(unwrap(await cancelDirectDebitRun(later, f.ctx, { runId: f.run.id }))).toMatchObject({ status: 'cancelled' });
  });

  it('a credit the bank books after all is still recognized over the end-to-end id (Review Focus 5)', async () => {
    const f = await withFile();
    const later = at(f.deps, '2026-11-15');
    const endToEndId = f.deps.db.select().from(financeDirectDebitItems).where(eq(financeDirectDebitItems.runId, f.run.id)).get()!.endToEndId;
    const raw = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 1200, date: '2026-10-30', endToEndId, name: null, iban: null });
    expect(unwrap(await suggestForTransaction(later, f.ctx, { rawTransactionId: raw }))).toMatchObject({ kind: 'directDebitRun', confidence: 'sure' });
  });
});

describe('the file is outdated when a mandate changed after it (M15)', () => {
  it('marking submitted is refused with runFileOutdated; building the file again carries the amendment', async () => {
    const f = await withFile();
    unwrap(await amendMandate(f.deps, f.ctx, { mandateId: f.a.mandateId, iban: IBANS[6], validFrom: '2026-10-20' }));
    expect(fail(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: f.run.id, submittedOn: '2026-10-20' }))).toMatchObject({ type: 'conflict', code: 'runFileOutdated', params: { reference: f.a.reference } });
    const rebuilt = unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    expect(rebuilt.items.map((i) => i.amended)).toEqual([true]);
    expect(unwrap(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: f.run.id, submittedOn: '2026-10-20' }))).toMatchObject({ status: 'submitted' });
  });

  it('a file still current cannot be built twice (runFileCreated as before)', async () => {
    const f = await withFile();
    expect(fail(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }))).toMatchObject({ code: 'runFileCreated' });
  });
});

describe('ending a mandate during a submitted run (M28)', () => {
  it('allowed from the day after the collection; earlier the message says so', async () => {
    const f = await withFile();
    unwrap(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: f.run.id, submittedOn: '2026-10-20' }));
    expect(fail(await endMandate(f.deps, f.ctx, { mandateId: f.a.mandateId, endedOn: '2026-10-25', reason: 'debtor' }))).toMatchObject({ type: 'conflict', code: 'mandateInSubmittedRun', params: { date: '2026-10-30', earliest: '2026-10-31' } });
    expect(unwrap(await endMandate(f.deps, f.ctx, { mandateId: f.a.mandateId, endedOn: '2026-10-31', reason: 'debtor' }))).toMatchObject({ endedOn: '2026-10-31' });
  });
});

describe('a second run on the same day (M32)', () => {
  it('names the draft of the same day and account in the result', async () => {
    const f = await directDebitFixture();
    const a = await f.payer('Erste');
    await f.fee(a, 1200, '2026-10-30');
    f.announce(a.mandateId, [{ dueOn: '2026-10-30', amountCents: 1200 }]);
    const first = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    expect(first.hints).toEqual([]);
    const b = await f.payer('Zweite');
    await f.fee(b, 900, '2026-10-30');
    f.announce(b.mandateId, [{ dueOn: '2026-10-30', amountCents: 900 }]);
    const second = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    expect(second.hints).toEqual([{ code: 'runSameDayDraft', runId: first.id }]);
  });
});

describe('pledge rates that cannot be or were not collected (M14, M40)', () => {
  it('a first rate inside the notice period is skipped with its reason; the notice names the first rate it can', async () => {
    const f = await directDebitFixture();
    const p = await f.payer('Spenderin');
    const saved = unwrap(await savePledge(f.deps, f.ctx, { contactId: p.contactId, amountCents: 1500, interval: 'monthly', firstDueOn: '2026-10-21', paymentMethod: 'directDebit', iban: IBANS[4], debtorName: 'Erika Spenderin' }));
    expect(saved.skippedRates).toEqual(['2026-10-21']);
    expect(f.deps.db.select().from(financePledgeRateMarks).all()).toMatchObject([{ pledgeId: saved.pledge.id, dueOn: '2026-10-21', mark: 'skipped', reason: 'notAnnounced' }]);
    const rates = unwrap(await getPledge(f.deps, f.ctx, { id: saved.pledge.id, from: '2026-10-01', to: '2026-11-30' })).rates;
    expect(rates.map((r) => [r.dueOn, r.state])).toEqual([['2026-10-21', 'skipped'], ['2026-11-21', 'expected']]);
  });

  it('a rate more than 30 days before the collection day is missed: at the pledge and as a line in the preview', async () => {
    const f = await directDebitFixture();
    const p = await f.payer('Spenderin');
    const august = at(f.deps, '2026-08-01');
    const pledge = unwrap(await savePledge(august, f.ctx, { contactId: p.contactId, amountCents: 1500, interval: 'monthly', firstDueOn: '2026-08-21', paymentMethod: 'directDebit', mandateId: p.mandateId })).pledge;
    const rates = unwrap(await getPledge(f.deps, f.ctx, { id: pledge.id, from: '2026-08-01', to: '2026-10-31' })).rates;
    expect(rates.map((r) => [r.dueOn, r.state])).toEqual([['2026-08-21', 'missed'], ['2026-09-21', 'expected'], ['2026-10-21', 'expected']]);
    const preview = unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    expect(preview.missedRates).toEqual([{ pledgeId: pledge.id, dueOn: '2026-08-21', amountCents: 1500, mandateReference: p.reference }, { pledgeId: pledge.id, dueOn: '2026-09-21', amountCents: 1500, mandateReference: p.reference }]);
  });
});
