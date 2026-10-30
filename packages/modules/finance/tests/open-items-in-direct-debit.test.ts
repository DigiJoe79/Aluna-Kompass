import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { buildDirectDebitFile, cancelDirectDebitRun, createDirectDebitRun, markDirectDebitRunSubmitted } from '../src/direct-debit/runs';
import { cancelOriginOpenItem, openItemInDirectDebitInternal, reduceOriginOpenItem } from '../src/ledger/open-items';
import { financeOpenItems } from '../src/schema';
import { directDebitFixture } from './direct-debit-fixture';

// Plan R1 Task 2 (M3). Uhr: Dienstag, 20.10.2026.
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);
const ORIGIN = 'feeSourceCharge';

/** Ein Beitrag mit Herkunft im Einzug zum 30.10. — noch im Entwurf. */
async function scene() {
  const f = await directDebitFixture();
  const a = await f.payer('Beispiel');
  const item = await f.fee(a, 1200, '2026-10-30');
  f.deps.db.update(financeOpenItems).set({ originType: ORIGIN, originId: 'C1' }).where(eq(financeOpenItems.id, item)).run();
  f.announce(a.mandateId, [{ dueOn: '2026-10-30', amountCents: 1200 }]);
  const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
  const cancel = () => f.deps.db.transaction((tx) => cancelOriginOpenItem(tx, f.deps, f.ctx, { openItemId: item, originType: ORIGIN, note: null }));
  const reduce = (amountCents: number) => f.deps.db.transaction((tx) => reduceOriginOpenItem(tx, f.deps, f.ctx, { openItemId: item, originType: ORIGIN, amountCents }));
  return { ...f, a, item, run, cancel, reduce };
}

describe('open items in a direct debit (M3)', () => {
  it('openItemInDirectDebitInternal names the run and its status; a cancelled run does not count', async () => {
    const f = await scene();
    expect(openItemInDirectDebitInternal(f.deps, f.deps.db, f.item)).toEqual({ runId: f.run.id, status: 'draft' });
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    expect(openItemInDirectDebitInternal(f.deps, f.deps.db, f.item)).toEqual({ runId: f.run.id, status: 'fileCreated' });
    unwrap(await cancelDirectDebitRun(f.deps, f.ctx, { runId: f.run.id }));
    expect(openItemInDirectDebitInternal(f.deps, f.deps.db, f.item)).toBeNull();
  });

  it('cancel and reduce are refused once the file is created or the run submitted', async () => {
    const f = await scene();
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    expect(fail(f.cancel())).toMatchObject({ type: 'conflict', code: 'openItemInDirectDebit', params: { runId: f.run.id, status: 'fileCreated' } });
    expect(fail(f.reduce(600))).toMatchObject({ code: 'openItemInDirectDebit', params: { status: 'fileCreated' } });
    unwrap(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: f.run.id, submittedOn: '2026-10-20' }));
    expect(fail(f.cancel())).toMatchObject({ code: 'openItemInDirectDebit', params: { runId: f.run.id, status: 'submitted' } });
  });

  it('in a draft the cancel goes through; the file then refuses the changed item as before', async () => {
    const f = await scene();
    expect(f.cancel()).toMatchObject({ ok: true });
    expect(fail(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }))).toMatchObject({ code: 'runItemChanged' });
  });
});
