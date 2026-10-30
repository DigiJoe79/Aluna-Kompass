import { fixedClock, schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { amendMandate, endMandate, getMandate } from '../src/direct-debit/mandates';
import { cancelOpenItem } from '../src/ledger/open-items';
import { buildDirectDebitFile, cancelDirectDebitRun, createDirectDebitRun, getDirectDebitRun, markDirectDebitRunSubmitted, previewDirectDebitRun, removeRunItem, resetDirectDebitRunSubmitted, runFileKey } from '../src/direct-debit/runs';
import { financeSepaMandates } from '../src/schema';
import { directDebitFixture, IBANS } from './direct-debit-fixture';

// Uhr: Dienstag, 20.10.2026. Plan L2 Task 4 — eingereicht, zurücksetzen, stornieren (Handoff 2a § 1.3, § 3).
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);

async function scene() {
  const f = await directDebitFixture();
  const a = await f.payer('Beispiel');
  const item = await f.fee(a, 1200, '2026-10-30');
  f.announce(a.mandateId, [{ dueOn: '2026-10-30', amountCents: 1200 }]);
  const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
  const mandate = () => f.deps.db.select().from(financeSepaMandates).where(eq(financeSepaMandates.id, a.mandateId)).get()!;
  const at = (iso: string) => ({ ...f.deps, clock: fixedClock(iso) });
  return { ...f, a, item, run, mandate, at };
}

describe('markDirectDebitRunSubmitted', () => {
  it('only within the submission window of the bank: not before submitFrom, not after submitBy', async () => {
    const f = await directDebitFixture();
    const a = await f.payer('Fenster');
    await f.fee(a, 1200, '2026-11-13');
    f.announce(a.mandateId, [{ dueOn: '2026-11-13', amountCents: 1200 }]);
    const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-11-13' }));
    // Die Datei geht jederzeit, auch vor dem Fenster.
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: run.id }));
    expect(unwrap(await getDirectDebitRun(f.deps, f.ctx, { id: run.id }))).toMatchObject({ submitFrom: '2026-10-30', submitBy: '2026-11-11' });
    const later = { ...f.deps, clock: fixedClock('2026-11-12T08:00:00.000Z') };
    expect(fail(await markDirectDebitRunSubmitted(later, f.ctx, { runId: run.id, submittedOn: '2026-10-29' }))).toMatchObject({ code: 'submitTooEarly', params: { date: '2026-10-30', collectionOn: '2026-11-13' } });
    expect(fail(await markDirectDebitRunSubmitted(later, f.ctx, { runId: run.id, submittedOn: '2026-11-12' }))).toMatchObject({ code: 'submitTooLate', params: { date: '2026-11-11', collectionOn: '2026-11-13' } });
    expect(unwrap(await markDirectDebitRunSubmitted(later, f.ctx, { runId: run.id, submittedOn: '2026-10-30' }))).toMatchObject({ status: 'submitted', submittedOn: '2026-10-30' });
  });

  it('only after the file; sets the last collection of each mandate, which extends it, and acknowledges the amendment', async () => {
    const f = await scene();
    unwrap(await amendMandate(f.deps, f.ctx, { mandateId: f.a.mandateId, iban: IBANS[6], validFrom: '2026-10-15' }));
    // Der Einzug war vor der Änderung angelegt: neu anlegen, damit der Posten den Hinweis trägt.
    unwrap(await cancelDirectDebitRun(f.deps, f.ctx, { runId: f.run.id }));
    const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    expect(fail(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: run.id, submittedOn: '2026-10-20' }))).toMatchObject({ code: 'runFileMissing' });
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: run.id }));
    const before = unwrap(await getMandate(f.deps, f.ctx, { id: f.a.mandateId })).expiresOn;
    const submitted = unwrap(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: run.id, submittedOn: '2026-10-20' }));
    expect(submitted).toMatchObject({ status: 'submitted', submittedOn: '2026-10-20' });
    expect(f.mandate()).toMatchObject({ lastCollectedOn: '2026-10-30', pendingAmendment: null });
    expect(before).toBe('2029-01-15');
    expect(unwrap(await getMandate(f.deps, f.ctx, { id: f.a.mandateId })).expiresOn).toBe('2029-10-30');
    expect(fail(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: run.id, submittedOn: '2026-10-20' }))).toMatchObject({ code: 'runSubmitted' });
    const audit = f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'finance.directDebit.submit')).all();
    expect(audit.map((a) => a.params)).toEqual([JSON.stringify({ collectionOn: '2026-10-30' })]);
  });

  it('needs finance.directDebit and a day not in the future', async () => {
    const f = await scene();
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    expect(fail(await markDirectDebitRunSubmitted(f.deps, ctxWith(['finance.read'], f.userId), { runId: f.run.id, submittedOn: '2026-10-20' }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: f.run.id, submittedOn: '2026-10-21' }))).toMatchObject({ type: 'validation' });
    expect(fail(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: 'NOPE', submittedOn: '2026-10-20' }))).toMatchObject({ type: 'notFound' });
  });

  it('an item can no longer be taken out once submitted', async () => {
    const f = await scene();
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    unwrap(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: f.run.id, submittedOn: '2026-10-20' }));
    expect(fail(await removeRunItem(f.deps, f.ctx, { itemId: f.run.items[0]!.id }))).toMatchObject({ code: 'runSubmitted' });
  });
});

describe('markDirectDebitRunSubmitted checks the items again (M1)', () => {
  const later = (f: { deps: Parameters<typeof markDirectDebitRunSubmitted>[0] }) => ({ ...f.deps, clock: fixedClock('2026-11-15T08:00:00.000Z') });

  it('an expired run whose items sit in a new run cannot be marked; the new one can', async () => {
    const f = await scene();
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    const now = later(f);
    f.announce(f.a.mandateId, [{ dueOn: '2026-11-20', amountCents: 1200 }], '2026-11-01');
    const b = unwrap(await createDirectDebitRun(now, f.ctx, { collectionDate: '2026-11-20' }));
    expect(b.items.map((i) => i.sourceId)).toEqual([f.item]);
    expect(fail(await markDirectDebitRunSubmitted(now, f.ctx, { runId: f.run.id, submittedOn: '2026-10-27' }))).toMatchObject({ type: 'conflict', code: 'runItemsChanged', params: { reference: f.a.reference } });
    unwrap(await buildDirectDebitFile(now, f.ctx, { runId: b.id }));
    expect(unwrap(await markDirectDebitRunSubmitted(now, f.ctx, { runId: b.id, submittedOn: '2026-11-15' }))).toMatchObject({ status: 'submitted' });
    expect(fail(await markDirectDebitRunSubmitted(now, f.ctx, { runId: f.run.id, submittedOn: '2026-10-27' }))).toMatchObject({ code: 'runItemsChanged' });
  });

  it('a mandate ended after the file refuses the marking', async () => {
    const f = await scene();
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    const now = later(f);
    unwrap(await endMandate(now, f.ctx, { mandateId: f.a.mandateId, endedOn: '2026-10-29', reason: 'debtor' }));
    expect(fail(await markDirectDebitRunSubmitted(now, f.ctx, { runId: f.run.id, submittedOn: '2026-10-27' }))).toMatchObject({ code: 'runItemsChanged', params: { reference: f.a.reference } });
  });

  it('an item cancelled after the file refuses the marking', async () => {
    const f = await scene();
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    unwrap(await cancelOpenItem(f.deps, f.ctx, { id: f.item, note: 'Irrtum' }));
    expect(fail(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: f.run.id, submittedOn: '2026-10-20' }))).toMatchObject({ code: 'runItemsChanged', params: { reference: f.a.reference } });
  });
});

describe('resetDirectDebitRunSubmitted', () => {
  it('on the same day: back to file created, last collection and amendment as before', async () => {
    const f = await scene();
    f.deps.db.update(financeSepaMandates).set({ pendingAmendment: { originalIban: IBANS[5], since: '2026-10-01' } }).where(eq(financeSepaMandates.id, f.a.mandateId)).run();
    unwrap(await cancelDirectDebitRun(f.deps, f.ctx, { runId: f.run.id }));
    const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: run.id }));
    unwrap(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: run.id, submittedOn: '2026-10-20' }));
    const reset = unwrap(await resetDirectDebitRunSubmitted(f.deps, f.ctx, { runId: run.id }));
    expect(reset).toMatchObject({ status: 'fileCreated', submittedOn: null });
    expect(f.mandate()).toMatchObject({ lastCollectedOn: null, pendingAmendment: { originalIban: IBANS[5], since: '2026-10-01' } });
    expect(f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'finance.directDebit.resetSubmit')).all().map((a) => a.params)).toEqual([JSON.stringify({ collectionOn: '2026-10-30' })]);
    expect(fail(await resetDirectDebitRunSubmitted(f.deps, f.ctx, { runId: run.id }))).toMatchObject({ code: 'runNotSubmitted' });
  });

  it('is refused the next day', async () => {
    const f = await scene();
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    unwrap(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: f.run.id, submittedOn: '2026-10-20' }));
    expect(fail(await resetDirectDebitRunSubmitted(f.at('2026-10-21T08:00:00.000Z'), f.ctx, { runId: f.run.id }))).toMatchObject({ code: 'runResetTooLate', params: { date: '2026-10-20' } });
  });
});

describe('cancelDirectDebitRun', () => {
  it('before submission freely: the items show again in the next preview and the files are gone', async () => {
    const f = await scene();
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    const cancelled = unwrap(await cancelDirectDebitRun(f.deps, f.ctx, { runId: f.run.id }));
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelledAt: '2026-10-20T08:00:00.000Z' });
    expect(await f.deps.files('finance').exists(runFileKey(f.run.id, 'xml'))).toBe(false);
    expect(unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' })).included.map((i) => i.sourceId)).toEqual([f.item]);
    expect(fail(await cancelDirectDebitRun(f.deps, f.ctx, { runId: f.run.id }))).toMatchObject({ code: 'runCancelled' });
    expect(fail(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }))).toMatchObject({ code: 'runCancelled' });
    const audit = f.deps.db.select().from(schema.auditLog).where(like(schema.auditLog.action, 'finance.directDebit.cancel')).all();
    expect(audit.map((a) => a.params)).toEqual([JSON.stringify({ collectionOn: '2026-10-30' })]);
  });

  it('after submission refused with the ways out (Handoff 2a § 3)', async () => {
    const f = await scene();
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    unwrap(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: f.run.id, submittedOn: '2026-10-20' }));
    expect(fail(await cancelDirectDebitRun(f.deps, f.ctx, { runId: f.run.id }))).toMatchObject({ code: 'runSubmitted' });
    expect(fail(await cancelDirectDebitRun(f.deps, ctxWith(['finance.read'], f.userId), { runId: f.run.id }))).toMatchObject({ type: 'forbidden' });
  });
});
